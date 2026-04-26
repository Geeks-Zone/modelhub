"use client";

const SESSION_STORAGE_PREFIX = "openclaw-bridge-session:";
const BRIDGE_CONNECT_TIMEOUT_MS = 25_000;
const BRIDGE_DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const BRIDGE_SESSION_ENSURE_TIMEOUT_MS = 45_000;
const BRIDGE_HEARTBEAT_INTERVAL_MS = 20_000;
const BRIDGE_HEARTBEAT_MAX_MISSES = 2;
const BRIDGE_RECONNECT_BASE_DELAY_MS = 1_000;
const BRIDGE_RECONNECT_MAX_DELAY_MS = 30_000;

export type OpenClawBridgeHello = {
  bridgeId?: string;
  bridgeToken?: string;
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
      detail?: unknown;
      label: string;
      requestId?: string;
      runId?: string;
      status?: "completed" | "error" | "running";
      step?: string;
      type: "run.status";
    }
  | {
      model: string;
      requestId?: string;
      type: "model.changed";
    }
  | {
      model?: { primary?: string | null };
      models?: Array<{ id: string; name: string }>;
      requestId?: string;
      type: "model.list";
    }
  | {
      requestId?: string;
      type: "ping" | "ready" | "pong";
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

const BRIDGE_CONNECTION_ERROR_MESSAGES = [
  "Bridge WS timeout",
  "Bridge WS connection",
  "Bridge WS connection failed",
  "Bridge WS disconnected",
  "Bridge WS connection timed out",
  "Bridge WS not connected",
];

export function isBridgeConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return BRIDGE_CONNECTION_ERROR_MESSAGES.some((prefix) => error.message.startsWith(prefix));
}

function getBridgeRequestTimeoutMs(type: string): number {
  if (type === "session.ensure") {
    return BRIDGE_SESSION_ENSURE_TIMEOUT_MS;
  }
  return BRIDGE_DEFAULT_REQUEST_TIMEOUT_MS;
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
  #heartbeatMisses = 0;
  #heartbeatTimer: number | null = null;
  #hello: OpenClawBridgeHello | null = null;
  // O hello e zerado em close() para sinalizar "WS aberto e healthy?".
  // Mas o token gerado pelo CLI nao muda entre reconexoes; cacheamos para
  // que o fallback HTTP possa autenticar mesmo enquanto o WS esta
  // momentaneamente caido. Limpamos apenas em disconnect() manual.
  #lastBridgeToken = "";
  #listeners = new Set<(event: OpenClawBridgeEvent) => void>();
  #manuallyClosed = false;
  #pendingRequests = new Map<string, PendingRequest>();
  #reconnectAttempt = 0;
  #reconnectTimer: number | null = null;
  #socket: WebSocket | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** Token recebido via hello WS, usado para autenticar fallback HTTP. */
  get bridgeToken(): string {
    return this.#hello?.bridgeToken || this.#lastBridgeToken;
  }

  async connect(): Promise<OpenClawBridgeHello> {
    this.#manuallyClosed = false;
    this.#clearReconnectTimer();
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
      const connectTimeoutId = window.setTimeout(() => {
        if (!settled) {
          settleReject(new Error("Bridge WS connection timed out"));
          try {
            socket.close();
          } catch {
            // ignore
          }
        }
      }, BRIDGE_CONNECT_TIMEOUT_MS);

      const settleResolve = (hello: OpenClawBridgeHello) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(connectTimeoutId);
        this.#hello = hello;
        if (hello.bridgeToken) {
          this.#lastBridgeToken = hello.bridgeToken;
        }
        this.#reconnectAttempt = 0;
        this.#startHeartbeat(socket);
        resolve(hello);
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(connectTimeoutId);
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
        if (message.type === "pong") {
          this.#heartbeatMisses = 0;
        }
        if (message.type === "hello") {
          settleResolve(message);
        }
      });

      socket.addEventListener("close", () => {
        this.#stopHeartbeat(socket);
        this.#hello = null;
        if (this.#socket === socket) {
          this.#socket = null;
        }
        this.#failPendingRequests(new Error("Bridge WS disconnected"));
        if (!settled) {
          settleReject(new Error("Bridge WS disconnected"));
        }
        if (!this.#manuallyClosed) {
          this.#scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        if (!settled) {
          settleReject(new Error("Bridge WS connection failed"));
        }
      });
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
    this.#manuallyClosed = true;
    this.#clearReconnectTimer();
    this.#hello = null;
    this.#lastBridgeToken = "";
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      this.#stopHeartbeat(socket);
      // O handler "close" ja chama #failPendingRequests; nao duplicamos aqui.
      // Se o socket ja estiver fechado, falhamos manualmente.
      if (socket.readyState === WebSocket.CLOSED) {
        this.#failPendingRequests(new Error("Bridge WS disconnected"));
      } else {
        socket.close();
      }
      return;
    }
    this.#failPendingRequests(new Error("Bridge WS disconnected"));
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
    if (!pending) {
      return;
    }

    if (pending.types.has(event.type)) {
      this.#pendingRequests.delete(requestId);
      pending.resolve(event);
      return;
    }

    if (event.type === "run.error") {
      this.#pendingRequests.delete(requestId);
      const message = "error" in event && event.error ? event.error : "bridge run.error";
      pending.reject(new Error(message));
    }
  }

  #failPendingRequests(error: Error) {
    for (const [requestId, pending] of this.#pendingRequests.entries()) {
      this.#pendingRequests.delete(requestId);
      pending.reject(error);
    }
  }

  #clearReconnectTimer() {
    if (this.#reconnectTimer) {
      window.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  #scheduleReconnect() {
    if (this.#reconnectTimer || this.#manuallyClosed) {
      return;
    }

    const attempt = this.#reconnectAttempt;
    const delayMs = Math.min(
      BRIDGE_RECONNECT_MAX_DELAY_MS,
      BRIDGE_RECONNECT_BASE_DELAY_MS * 2 ** attempt,
    );
    this.#reconnectAttempt = attempt + 1;
    this.#reconnectTimer = window.setTimeout(() => {
      this.#reconnectTimer = null;
      void this.connect().catch(() => {
        this.#scheduleReconnect();
      });
    }, delayMs);
  }

  #startHeartbeat(socket: WebSocket) {
    this.#stopHeartbeat(socket);
    this.#heartbeatMisses = 0;
    this.#heartbeatTimer = window.setInterval(() => {
      if (this.#socket !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (this.#heartbeatMisses >= BRIDGE_HEARTBEAT_MAX_MISSES) {
        socket.close();
        return;
      }

      this.#heartbeatMisses += 1;
      try {
        socket.send(JSON.stringify({ type: "ping" }));
      } catch {
        socket.close();
      }
    }, BRIDGE_HEARTBEAT_INTERVAL_MS);
  }

  #stopHeartbeat(socket?: WebSocket) {
    if (socket && this.#socket !== socket) {
      return;
    }
    if (this.#heartbeatTimer) {
      window.clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = null;
    }
    this.#heartbeatMisses = 0;
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
    const requestType = typeof payload.type === "string" ? payload.type : "request";
    const timeoutMs = getBridgeRequestTimeoutMs(requestType);

    return new Promise<OpenClawBridgeEvent>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.#pendingRequests.delete(requestId);
        if (requestType === "session.ensure") {
          reject(new Error("Bridge WS timeout for session.ensure (o gateway local demorou para preparar a sessao)"));
          return;
        }
        reject(new Error(`Bridge WS timeout for ${requestType}`));
      }, timeoutMs);

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
