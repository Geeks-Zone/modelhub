"use client";

const SESSION_STORAGE_PREFIX = "openclaw-bridge-session:";

export type OpenClawBridgeHello = {
  bridgeId?: string;
  gateway?: { ok?: boolean; ws?: boolean };
  model?: { primary?: string | null };
  models?: Array<{ id: string; name: string }>;
  type: "hello";
};

export type OpenClawBridgeEvent =
  | OpenClawBridgeHello
  | {
      conversationId?: string;
      requestId?: string;
      sessionKey?: string;
      type: "session.ready";
    }
  | {
      delta: string;
      requestId?: string;
      runId?: string;
      type: "chat.delta";
    }
  | {
      requestId?: string;
      runId?: string;
      type: "chat.aborted";
    }
  | {
      approvalId: string;
      args?: unknown;
      requestId?: string;
      runId?: string;
      toolCallId?: string;
      toolName?: string;
      type: "tool.approval.requested";
    }
  | {
      approvalId?: string;
      requestId?: string;
      runId?: string;
      type: "tool.approval.resolved";
    }
  | {
      args?: unknown;
      requestId?: string;
      result?: unknown;
      runId?: string;
      status?: string;
      toolCallId: string;
      toolName?: string;
      type: "tool.update";
    }
  | {
      error: string;
      requestId?: string;
      runId?: string;
      type: "run.error";
    }
  | {
      requestId?: string;
      runId?: string;
      type: "run.completed";
    }
  | {
      model: string;
      requestId?: string;
      type: "model.changed";
    }
  | {
      models: Array<{ id: string; name: string }>;
      requestId?: string;
      type: "model.list";
    }
  | {
      requestId?: string;
      type: "ready" | "pong";
    };

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (event: OpenClawBridgeEvent) => void;
  types: Set<string>;
};

function buildBridgeWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl.replace(/\/+$/, ""));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function loadOpenClawBridgeSessionKey(conversationId: string): string {
  if (typeof window === "undefined" || !conversationId) {
    return "";
  }
  return localStorage.getItem(`${SESSION_STORAGE_PREFIX}${conversationId}`)?.trim() ?? "";
}

export function saveOpenClawBridgeSessionKey(conversationId: string, sessionKey: string): void {
  if (typeof window === "undefined" || !conversationId || !sessionKey) {
    return;
  }
  localStorage.setItem(`${SESSION_STORAGE_PREFIX}${conversationId}`, sessionKey);
}

export class OpenClawBridgeClient {
  readonly baseUrl: string;

  #connectPromise: Promise<OpenClawBridgeHello> | null = null;
  #hello: OpenClawBridgeHello | null = null;
  #listeners = new Set<(event: OpenClawBridgeEvent) => void>();
  #pendingRequests = new Map<string, PendingRequest>();
  #socket: WebSocket | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async connect(): Promise<OpenClawBridgeHello> {
    if (this.#hello && this.#socket?.readyState === WebSocket.OPEN) {
      return this.#hello;
    }
    if (this.#connectPromise) {
      return this.#connectPromise;
    }

    this.#connectPromise = new Promise<OpenClawBridgeHello>((resolve, reject) => {
      const socket = new WebSocket(buildBridgeWebSocketUrl(this.baseUrl));
      this.#socket = socket;
      let settled = false;

      const settleResolve = (hello: OpenClawBridgeHello) => {
        if (settled) {
          return;
        }
        settled = true;
        this.#hello = hello;
        resolve(hello);
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "ready" }));
      });

      socket.addEventListener("message", (event) => {
        let message: OpenClawBridgeEvent;
        try {
          message = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as OpenClawBridgeEvent;
        } catch {
          return;
        }
        this.#dispatch(message);
        if (message.type === "hello") {
          settleResolve(message);
        }
      });

      socket.addEventListener("close", () => {
        this.#hello = null;
        this.#socket = null;
        this.#failPendingRequests(new Error("Bridge WS disconnected"));
        if (!settled) {
          settleReject(new Error("Bridge WS disconnected"));
        }
      });

      socket.addEventListener("error", () => {
        if (!settled) {
          settleReject(new Error("Bridge WS connection failed"));
        }
      });

      window.setTimeout(() => {
        if (!settled) {
          try {
            socket.close();
          } catch {
            // ignore
          }
          settleReject(new Error("Bridge WS connection timed out"));
        }
      }, 10000);
    }).finally(() => {
      this.#connectPromise = null;
    });

    return this.#connectPromise;
  }

  onMessage(listener: (event: OpenClawBridgeEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async ensureSession(input: {
    conversationId: string;
    model?: string;
    sessionKey?: string;
  }): Promise<{ conversationId?: string; sessionKey?: string }> {
    const requestId = crypto.randomUUID();
    const event = await this.#request(requestId, new Set(["session.ready"]), {
      conversationId: input.conversationId,
      model: input.model,
      sessionKey: input.sessionKey,
      type: "session.ensure",
    });
    return {
      conversationId: "conversationId" in event ? event.conversationId : undefined,
      sessionKey: "sessionKey" in event ? event.sessionKey : undefined,
    };
  }

  async changeModel(model: string): Promise<void> {
    const requestId = crypto.randomUUID();
    await this.#request(requestId, new Set(["model.changed"]), {
      model,
      type: "model.change",
    });
  }

  async sendChat(input: {
    content: string;
    conversationId: string;
    model?: string;
    requestId: string;
    sessionKey?: string;
  }): Promise<void> {
    await this.#send({
      content: input.content,
      conversationId: input.conversationId,
      model: input.model,
      requestId: input.requestId,
      sessionKey: input.sessionKey,
      type: "chat.send",
    });
  }

  async abort(requestId?: string): Promise<void> {
    await this.#send({
      requestId,
      type: "chat.abort",
    });
  }

  async resolveApproval(input: {
    approvalId: string;
    approved: boolean;
    reason?: string;
  }): Promise<void> {
    const requestId = crypto.randomUUID();
    await this.#request(requestId, new Set(["tool.approval.resolved"]), {
      approvalId: input.approvalId,
      approved: input.approved,
      reason: input.reason,
      type: "tool.approval.resolve",
    });
  }

  disconnect(): void {
    this.#hello = null;
    if (this.#socket) {
      this.#socket.close();
      this.#socket = null;
    }
  }

  #dispatch(event: OpenClawBridgeEvent) {
    for (const listener of this.#listeners) {
      listener(event);
    }

    const requestId = "requestId" in event ? event.requestId : undefined;
    if (!requestId) {
      return;
    }

    const pending = this.#pendingRequests.get(requestId);
    if (!pending || !pending.types.has(event.type)) {
      return;
    }

    this.#pendingRequests.delete(requestId);
    pending.resolve(event);
  }

  #failPendingRequests(error: Error) {
    for (const [requestId, pending] of this.#pendingRequests.entries()) {
      this.#pendingRequests.delete(requestId);
      pending.reject(error);
    }
  }

  async #send(payload: Record<string, unknown>): Promise<void> {
    await this.connect();
    if (!this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge WS not connected");
    }
    this.#socket.send(JSON.stringify(payload));
  }

  async #request(requestId: string, types: Set<string>, payload: Record<string, unknown>): Promise<OpenClawBridgeEvent> {
    await this.connect();

    return new Promise<OpenClawBridgeEvent>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.#pendingRequests.delete(requestId);
        reject(new Error(`Bridge WS timeout for ${payload.type}`));
      }, 10000);

      this.#pendingRequests.set(requestId, {
        reject: (error) => {
          window.clearTimeout(timeoutId);
          reject(error);
        },
        resolve: (event) => {
          window.clearTimeout(timeoutId);
          resolve(event);
        },
        types,
      });

      void this.#send({ ...payload, requestId }).catch((error) => {
        window.clearTimeout(timeoutId);
        this.#pendingRequests.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}
