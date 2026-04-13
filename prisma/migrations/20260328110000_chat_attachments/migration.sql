-- Add structured parts to messages while preserving legacy content fallback
ALTER TABLE "Message" ADD COLUMN "parts" JSONB;

-- Persist conversation-scoped attachments in Postgres
CREATE TABLE "ConversationAttachment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "blob" BYTEA NOT NULL,
    "extractedText" TEXT,
    "extractionStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationAttachment_conversationId_createdAt_idx"
ON "ConversationAttachment"("conversationId", "createdAt");

CREATE INDEX "ConversationAttachment_messageId_idx"
ON "ConversationAttachment"("messageId");

ALTER TABLE "ConversationAttachment"
ADD CONSTRAINT "ConversationAttachment_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationAttachment"
ADD CONSTRAINT "ConversationAttachment_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "Message"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
