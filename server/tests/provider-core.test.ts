import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = {
  conversationAttachment: { findMany: vi.fn().mockResolvedValue([]) },
  providerCredential: { findMany: vi.fn().mockResolvedValue([]) },
  usageLog: { create: vi.fn().mockReturnValue({ catch: vi.fn() }) },
};

vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../env", () => ({}));
vi.mock("@/lib/auth/server", () => ({ auth: { getSession: vi.fn().mockResolvedValue({ data: null }) } }));

const { createProviderApp, MAX_PROVIDER_REQUEST_BODY_BYTES, resolveMessagesForProvider } = await import("../lib/provider-core");

const originalRequireAuth = process.env.REQUIRE_AUTH;

describe("provider payload limits", () => {
  beforeEach(() => {
    process.env.REQUIRE_AUTH = "false";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.REQUIRE_AUTH = originalRequireAuth;
  });

  it("rejects oversized request bodies before parsing", async () => {
    const app = createProviderApp({
      basePath: "/test-provider",
      chat: async () => new Response("ok"),
      defaultModel: "demo-model",
      models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
      providerId: "test-provider",
    });

    const response = await app.request("/test-provider/api/chat", {
      body: JSON.stringify({
        messages: [{ content: "hello", role: "user" }],
      }),
      headers: {
        "content-length": String(MAX_PROVIDER_REQUEST_BODY_BYTES + 1),
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
  });

  it("injects extracted document text into the provider payload", async () => {
    mockPrisma.conversationAttachment.findMany.mockResolvedValueOnce([
      {
        blob: new Uint8Array([1, 2, 3]),
        extractedText: "Quarterly report body",
        extractionStatus: "completed",
        fileName: "report.docx",
        id: "att-doc-1",
        kind: "document",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]);

    const messages = await resolveMessagesForProvider({
      config: {
        basePath: "/test-provider",
        chat: async () => new Response("ok"),
        defaultModel: "demo-model",
        models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
        providerId: "test-provider",
      },
      credentials: {},
      messages: [{
        content: [{
          attachmentId: "att-doc-1",
          fileName: "report.docx",
          kind: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          type: "attachment",
        }],
        role: "user",
      }],
      modelId: "demo-model",
      userId: "user-1",
    });

    expect(messages[0]?.content).toEqual([
      {
        text: "[document:report.docx mime=application/vnd.openxmlformats-officedocument.wordprocessingml.document]\nQuarterly report body\n[/document]",
        type: "text",
      },
    ]);
  });

  it("rejects image attachments when the selected model lacks vision support", async () => {
    mockPrisma.conversationAttachment.findMany.mockResolvedValueOnce([
      {
        blob: new Uint8Array([255, 216, 255]),
        extractedText: null,
        extractionStatus: "completed",
        fileName: "photo.jpg",
        id: "att-img-1",
        kind: "image",
        mimeType: "image/jpeg",
      },
    ]);

    await expect(
      resolveMessagesForProvider({
        config: {
          basePath: "/test-provider",
          chat: async () => new Response("ok"),
          defaultModel: "demo-model",
          models: [{ capabilities: { documents: true, images: false }, id: "demo-model", name: "Demo Model" }],
          providerId: "test-provider",
        },
        credentials: {},
        messages: [{
          content: [{
            attachmentId: "att-img-1",
            fileName: "photo.jpg",
            kind: "image",
            mimeType: "image/jpeg",
            type: "attachment",
          }],
          role: "user",
        }],
        modelId: "demo-model",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({
      message: 'Modelo "demo-model" nao suporta anexos de imagem',
      status: 400,
    });
  });
});
