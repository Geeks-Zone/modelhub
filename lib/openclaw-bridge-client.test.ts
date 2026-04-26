import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isBridgeConnectionError, OpenClawBridgeClient } from "./openclaw-bridge-client";

type FakeListener = (event?: { data?: string }) => void;

class FakeWebSocket {
  static CLOSED = 3;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static autoConnect = true;
  static autoHello = true;

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  #listeners = new Map<string, Set<FakeListener>>();

  constructor() {
    FakeWebSocket.instances.push(this);
    if (!FakeWebSocket.autoConnect) {
      return;
    }
    setTimeout(() => {
      if (this.readyState === FakeWebSocket.CLOSED) {
        return;
      }
      this.readyState = FakeWebSocket.OPEN;
      this.#emit("open");
      if (FakeWebSocket.autoHello) {
        this.emitMessage({
          gateway: { ok: false, ws: false },
          model: { primary: "modelhub/cerebras/llama3.1-8b" },
          models: [{ id: "modelhub/cerebras/llama3.1-8b", name: "Llama 3.1 8B" }],
          type: "hello",
        });
      }
    }, 0);
  }

  addEventListener(type: string, listener: FakeListener) {
    const listeners = this.#listeners.get(type) ?? new Set<FakeListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit("close");
  }

  emitMessage(message: unknown) {
    this.#emit("message", { data: JSON.stringify(message) });
  }

  send(data: string) {
    this.sent.push(String(data));
  }

  #emit(type: string, event: { data?: string } = {}) {
    const listeners = this.#listeners.get(type);
    if (!listeners) {
      return;
    }
    for (const listener of listeners) {
      listener(event);
    }
  }
}

describe("OpenClawBridgeClient", () => {
  const originalWindow = globalThis.window;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    FakeWebSocket.autoConnect = true;
    FakeWebSocket.autoHello = true;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
    if (originalWebSocket === undefined) {
      Reflect.deleteProperty(globalThis, "WebSocket");
    } else {
      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        value: originalWebSocket,
      });
    }
  });

  it("waits longer for session.ensure before timing out", async () => {
    const client = new OpenClawBridgeClient("http://127.0.0.1:18790");
    const ensurePromise = client.ensureSession({
      conversationId: "conv-1",
      model: "modelhub/cerebras/llama3.1-8b",
    });

    await vi.advanceTimersByTimeAsync(0);

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    const ensureMessage = socket.sent
      .map((payload) => JSON.parse(payload) as { requestId?: string; type?: string })
      .find((payload) => payload.type === "session.ensure");

    expect(ensureMessage?.requestId).toBeTruthy();

    await vi.advanceTimersByTimeAsync(11_000);

    socket.emitMessage({
      conversationId: "conv-1",
      requestId: ensureMessage?.requestId,
      sessionKey: "modelhub:conv-1",
      type: "session.ready",
    });

    await expect(ensurePromise).resolves.toEqual({
      conversationId: "conv-1",
      sessionKey: "modelhub:conv-1",
    });
    client.disconnect();
  });

  it("uses a 25s connect timeout before falling back", async () => {
    FakeWebSocket.autoConnect = false;
    const client = new OpenClawBridgeClient("http://127.0.0.1:18790");

    const connectPromise = client.connect();
    const timeoutAssertion = expect(connectPromise).rejects.toThrow("Bridge WS connection timed out");

    await vi.advanceTimersByTimeAsync(24_999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CONNECTING);

    await vi.advanceTimersByTimeAsync(1);
    await timeoutAssertion;
    client.disconnect();
  });

  it("rejects pending requests when the socket closes", async () => {
    const client = new OpenClawBridgeClient("http://127.0.0.1:18790");
    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;

    const ensurePromise = client.ensureSession({
      conversationId: "conv-pending",
      model: "modelhub/cerebras/llama3.1-8b",
    });
    await vi.advanceTimersByTimeAsync(0);

    FakeWebSocket.instances[0].close();

    await expect(ensurePromise).rejects.toThrow("Bridge WS disconnected");
    client.disconnect();
  });

  it("reconnects after an unexpected close without reenqueuing sent messages", async () => {
    const client = new OpenClawBridgeClient("http://127.0.0.1:18790");
    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.close();

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].sent.map((payload) => JSON.parse(payload))).toEqual([
      { type: "ready" },
    ]);
    client.disconnect();
  });

  it("closes and reconnects when app-level heartbeat misses pong twice", async () => {
    const client = new OpenClawBridgeClient("http://127.0.0.1:18790");
    const connectPromise = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await connectPromise;

    const socket = FakeWebSocket.instances[0];

    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.sent.map((payload) => JSON.parse(payload)).filter((payload) => payload.type === "ping")).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("classifies expanded bridge connection failures for HTTP fallback", () => {
    expect(isBridgeConnectionError(new Error("Bridge WS timeout for session.ensure"))).toBe(true);
    expect(isBridgeConnectionError(new Error("Bridge WS connection reset"))).toBe(true);
    expect(isBridgeConnectionError(new Error("Bridge WS disconnected"))).toBe(true);
    expect(isBridgeConnectionError(new Error("Backend run.error"))).toBe(false);
  });
});
