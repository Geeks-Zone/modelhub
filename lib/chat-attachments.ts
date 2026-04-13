export const MAX_ATTACHMENT_FILE_BYTES = Math.floor(1.5 * 1024 * 1024);
export const MAX_TOTAL_ATTACHMENT_BYTES = Math.floor(2.5 * 1024 * 1024);
export const MAX_SERIALIZED_CHAT_REQUEST_BYTES = Math.floor(3.5 * 1024 * 1024);
export const MAX_DOCUMENT_ATTACHMENT_FILE_BYTES = Math.floor(5 * 1024 * 1024);
export const MAX_TOTAL_DOCUMENT_ATTACHMENT_BYTES = Math.floor(10 * 1024 * 1024);

type AttachmentLike = {
  size: number;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getTotalAttachmentBytes(attachments: AttachmentLike[]): number {
  return attachments.reduce((total, attachment) => total + attachment.size, 0);
}

export function getTotalAttachmentBytesByType<T extends AttachmentLike & { kind: "document" | "image" }>(
  attachments: T[],
  kind: T["kind"],
): number {
  return attachments
    .filter((attachment) => attachment.kind === kind)
    .reduce((total, attachment) => total + attachment.size, 0);
}

export function estimateSerializedPayloadBytes(payload: unknown): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function isSerializedPayloadTooLarge(
  payload: unknown,
  maxBytes = MAX_SERIALIZED_CHAT_REQUEST_BYTES,
): boolean {
  return estimateSerializedPayloadBytes(payload) > maxBytes;
}
