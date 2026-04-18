import { describe, expect, it } from "vitest";

import {
  MAX_DOCUMENT_ATTACHMENT_FILE_BYTES,
  MAX_DOCUMENT_ATTACHMENT_TOTAL_BYTES,
  MAX_IMAGE_ATTACHMENT_FILE_BYTES,
  MAX_IMAGE_ATTACHMENT_TOTAL_BYTES,
  buildAttachmentContentUrl,
  buildDocumentContextBlock,
  buildFallbackContentFromHydratedParts,
  getAttachmentByteLimit,
  getAttachmentTotalByteLimit,
  getAttachmentValidationError,
  hydrateMessageParts,
  parseStoredMessageParts,
  resolveAttachmentKind,
  sanitizeExtractedText,
  toAttachmentDescriptor,
} from "../lib/conversation-attachments";

// ─── resolveAttachmentKind ─────────────────────────────────────────

describe("resolveAttachmentKind", () => {
  it.each([
    ["image/jpeg", "image"],
    ["image/png", "image"],
    ["image/gif", "image"],
    ["image/webp", "image"],
  ])("reconhece %s como imagem", (mime, expected) => {
    expect(resolveAttachmentKind(mime)).toBe(expected);
  });

  it.each([
    ["application/pdf", "document"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "document"],
  ])("reconhece %s como documento", (mime, expected) => {
    expect(resolveAttachmentKind(mime)).toBe(expected);
  });

  it("retorna null para tipo não suportado", () => {
    expect(resolveAttachmentKind("text/plain")).toBeNull();
    expect(resolveAttachmentKind("video/mp4")).toBeNull();
    expect(resolveAttachmentKind("")).toBeNull();
  });
});

// ─── getAttachmentByteLimit ────────────────────────────────────────

describe("getAttachmentByteLimit", () => {
  it("retorna limite correto para imagem", () => {
    expect(getAttachmentByteLimit("image")).toBe(MAX_IMAGE_ATTACHMENT_FILE_BYTES);
  });

  it("retorna limite correto para documento", () => {
    expect(getAttachmentByteLimit("document")).toBe(MAX_DOCUMENT_ATTACHMENT_FILE_BYTES);
  });
});

// ─── getAttachmentTotalByteLimit ───────────────────────────────────

describe("getAttachmentTotalByteLimit", () => {
  it("retorna limite total correto para imagem", () => {
    expect(getAttachmentTotalByteLimit("image")).toBe(MAX_IMAGE_ATTACHMENT_TOTAL_BYTES);
  });

  it("retorna limite total correto para documento", () => {
    expect(getAttachmentTotalByteLimit("document")).toBe(MAX_DOCUMENT_ATTACHMENT_TOTAL_BYTES);
  });
});

// ─── getAttachmentValidationError ─────────────────────────────────

describe("getAttachmentValidationError", () => {
  it("retorna null para arquivo válido de imagem dentro do limite", () => {
    const file = new File([new Uint8Array(100)], "photo.jpg", { type: "image/jpeg" });
    expect(getAttachmentValidationError(file)).toBeNull();
  });

  it("retorna null para documento válido dentro do limite", () => {
    const file = new File([new Uint8Array(1000)], "doc.pdf", { type: "application/pdf" });
    expect(getAttachmentValidationError(file)).toBeNull();
  });

  it("retorna erro para tipo não suportado", () => {
    const file = new File(["content"], "video.mp4", { type: "video/mp4" });
    const error = getAttachmentValidationError(file);
    expect(error).toContain("Tipo nao suportado");
    expect(error).toContain("video.mp4");
  });

  it("retorna erro para imagem acima do limite", () => {
    const oversized = new Uint8Array(MAX_IMAGE_ATTACHMENT_FILE_BYTES + 1);
    const file = new File([oversized], "big.png", { type: "image/png" });
    const error = getAttachmentValidationError(file);
    expect(error).toContain("Arquivo muito grande");
    expect(error).toContain("big.png");
  });

  it("retorna erro para documento acima do limite", () => {
    const oversized = new Uint8Array(MAX_DOCUMENT_ATTACHMENT_FILE_BYTES + 1);
    const file = new File([oversized], "big.pdf", { type: "application/pdf" });
    const error = getAttachmentValidationError(file);
    expect(error).toContain("Arquivo muito grande");
  });
});

// ─── sanitizeExtractedText ─────────────────────────────────────────

describe("sanitizeExtractedText", () => {
  it("remove null bytes", () => {
    expect(sanitizeExtractedText("hello\u0000world")).toBe("hello world");
  });

  it("normaliza CRLF para LF", () => {
    expect(sanitizeExtractedText("line1\r\nline2")).toBe("line1\nline2");
  });

  it("colapsa múltiplas linhas em branco para no máximo duas", () => {
    expect(sanitizeExtractedText("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("faz trim do resultado", () => {
    expect(sanitizeExtractedText("  hello  ")).toBe("hello");
  });

  it("preserva texto limpo sem alterações", () => {
    expect(sanitizeExtractedText("linha 1\nlinha 2")).toBe("linha 1\nlinha 2");
  });
});

// ─── buildAttachmentContentUrl ─────────────────────────────────────

describe("buildAttachmentContentUrl", () => {
  it("gera URL correta", () => {
    expect(buildAttachmentContentUrl("conv-1", "att-2")).toBe(
      "/conversations/conv-1/attachments/att-2/content",
    );
  });
});

// ─── toAttachmentDescriptor ────────────────────────────────────────

describe("toAttachmentDescriptor", () => {
  it("converte registro para descriptor com contentUrl", () => {
    const record = {
      byteSize: 1024,
      extractionStatus: "completed",
      fileName: "report.pdf",
      id: "att-1",
      kind: "document",
      mimeType: "application/pdf",
    };

    const descriptor = toAttachmentDescriptor(record, "conv-1");

    expect(descriptor).toEqual({
      byteSize: 1024,
      contentUrl: "/conversations/conv-1/attachments/att-1/content",
      extractionStatus: "completed",
      fileName: "report.pdf",
      id: "att-1",
      kind: "document",
      mimeType: "application/pdf",
    });
  });
});

// ─── buildDocumentContextBlock ─────────────────────────────────────

describe("buildDocumentContextBlock", () => {
  it("retorna bloco vazio quando remainingChars é 0", () => {
    const result = buildDocumentContextBlock({
      extractedText: "some text",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      remainingChars: 0,
      status: "completed",
    });

    expect(result.text).toBe("");
    expect(result.consumedChars).toBe(0);
  });

  it("inclui texto extraído no bloco", () => {
    const result = buildDocumentContextBlock({
      extractedText: "conteúdo do documento",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      remainingChars: 10000,
      status: "completed",
    });

    expect(result.text).toContain("[document:doc.pdf");
    expect(result.text).toContain("conteúdo do documento");
    expect(result.text).toContain("[/document]");
    expect(result.consumedChars).toBe("conteúdo do documento".length);
  });

  it("trunca texto quando excede remainingChars", () => {
    const result = buildDocumentContextBlock({
      extractedText: "abcdefghij",
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      remainingChars: 5,
      status: "completed",
    });

    expect(result.text).toContain("abcde");
    expect(result.text).toContain("[truncated]");
    expect(result.consumedChars).toBe(5);
  });

  it("retorna mensagem de scan não suportado quando status é unsupported_scan", () => {
    const result = buildDocumentContextBlock({
      extractedText: null,
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      remainingChars: 10000,
      status: "unsupported_scan",
    });

    expect(result.text).toContain("possivel scan");
    expect(result.consumedChars).toBe(0);
  });

  it("retorna mensagem de conteúdo indisponível quando status é failed", () => {
    const result = buildDocumentContextBlock({
      extractedText: null,
      fileName: "broken.pdf",
      mimeType: "application/pdf",
      remainingChars: 10000,
      status: "failed",
    });

    expect(result.text).toContain("Conteudo indisponivel");
    expect(result.consumedChars).toBe(0);
  });
});

// ─── parseStoredMessageParts ───────────────────────────────────────

describe("parseStoredMessageParts", () => {
  it("retorna parte de texto a partir de fallback quando value não é array", () => {
    const parts = parseStoredMessageParts(null, "fallback text");
    expect(parts).toEqual([{ text: "fallback text", type: "text" }]);
  });

  it("retorna array vazio quando value não é array e fallback é vazio", () => {
    const parts = parseStoredMessageParts(null, "");
    expect(parts).toEqual([]);
  });

  it("parseia partes de texto corretamente", () => {
    const parts = parseStoredMessageParts(
      [{ type: "text", text: "hello" }],
      "",
    );
    expect(parts).toEqual([{ text: "hello", type: "text" }]);
  });

  it("parseia partes de attachment corretamente", () => {
    const parts = parseStoredMessageParts(
      [
        {
          type: "attachment",
          attachmentId: "att-1",
          kind: "image",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
      "",
    );
    expect(parts).toEqual([
      {
        attachmentId: "att-1",
        fileName: "photo.jpg",
        kind: "image",
        mimeType: "image/jpeg",
        type: "attachment",
      },
    ]);
  });

  it("ignora partes com tipo desconhecido", () => {
    const parts = parseStoredMessageParts([{ type: "unknown", data: "x" }], "fallback");
    expect(parts).toEqual([{ text: "fallback", type: "text" }]);
  });

  it("usa fallback quando array resulta em partes vazias", () => {
    const parts = parseStoredMessageParts([], "fallback");
    expect(parts).toEqual([{ text: "fallback", type: "text" }]);
  });
});

// ─── hydrateMessageParts ───────────────────────────────────────────

describe("hydrateMessageParts", () => {
  const attachment = {
    byteSize: 512,
    extractionStatus: "completed",
    fileName: "photo.jpg",
    id: "att-1",
    kind: "image",
    mimeType: "image/jpeg",
  };

  it("hidrata partes de texto sem alteração", () => {
    const result = hydrateMessageParts({
      attachmentsById: new Map(),
      conversationId: "conv-1",
      fallbackContent: "",
      parts: [{ type: "text", text: "hello" }],
    });

    expect(result).toEqual([{ text: "hello", type: "text" }]);
  });

  it("hidrata partes de attachment com descriptor completo", () => {
    const result = hydrateMessageParts({
      attachmentsById: new Map([["att-1", attachment]]),
      conversationId: "conv-1",
      fallbackContent: "",
      parts: [
        {
          type: "attachment",
          attachmentId: "att-1",
          kind: "image",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(result[0]).toMatchObject({
      attachmentId: "att-1",
      contentUrl: "/conversations/conv-1/attachments/att-1/content",
      kind: "image",
    });
  });

  it("omite attachment quando não encontrado no map", () => {
    const result = hydrateMessageParts({
      attachmentsById: new Map(),
      conversationId: "conv-1",
      fallbackContent: "",
      parts: [
        {
          type: "attachment",
          attachmentId: "att-missing",
          kind: "image",
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(result).toHaveLength(0);
  });
});

// ─── buildFallbackContentFromHydratedParts ─────────────────────────

describe("buildFallbackContentFromHydratedParts", () => {
  it("retorna texto de partes de texto", () => {
    const result = buildFallbackContentFromHydratedParts([
      { type: "text", text: "hello world" },
    ]);
    expect(result).toContain("hello world");
  });

  it("retorna string vazia para array vazio", () => {
    const result = buildFallbackContentFromHydratedParts([]);
    expect(result).toBe("");
  });
});
