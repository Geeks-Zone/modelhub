import { z } from 'zod';

const contentPartSchema = z.object({
  text: z.string().optional(),
  type: z.string().optional(),
}).passthrough();

const messageSchema = z.object({
  content: z.union([z.string(), z.array(contentPartSchema)]).optional(),
  delta: z.string().optional(),
  errorMessage: z.string().optional(),
  role: z.string().optional(),
  stopReason: z.string().optional(),
  text: z.string().optional(),
}).passthrough();

const gatewayPayloadBaseSchema = z.object({
  callId: z.string().optional(),
  error: z.unknown().optional(),
  id: z.string().optional(),
  kind: z.string().optional(),
  message: messageSchema.optional(),
  phase: z.string().optional(),
  runId: z.string().optional(),
  sessionKey: z.string().optional(),
  state: z.string().optional(),
  status: z.string().optional(),
  toolCallId: z.string().optional(),
  type: z.string().optional(),
}).passthrough();

const sessionMessagePayloadSchema = gatewayPayloadBaseSchema.extend({
  content: z.union([z.string(), z.array(contentPartSchema)]).optional(),
  delta: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
});

const sessionToolPayloadSchema = gatewayPayloadBaseSchema.extend({
  args: z.unknown().optional(),
  arguments: z.unknown().optional(),
  command: z.string().optional(),
  input: z.unknown().optional(),
  name: z.string().optional(),
  output: z.unknown().optional(),
  result: z.unknown().optional(),
  tool: z.string().optional(),
  toolName: z.string().optional(),
});

const approvalPayloadSchema = sessionToolPayloadSchema.extend({
  approvalId: z.string().optional(),
  argv: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  rawCommand: z.string().optional(),
  systemRunPlan: z.unknown().optional(),
});

const schemaByEvent = new Map([
  ['exec.approval.requested', approvalPayloadSchema],
  ['exec.approval.resolved', approvalPayloadSchema],
  ['session.message', sessionMessagePayloadSchema],
  ['session.tool', sessionToolPayloadSchema],
]);

export function parseBridgeEventPayload(eventName, payload) {
  const schema = schemaByEvent.get(String(eventName || '')) || gatewayPayloadBaseSchema;
  const result = schema.safeParse(payload);
  if (result.success) {
    return { ok: true, payload: result.data };
  }

  return {
    error: result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; '),
    ok: false,
    payload: null,
  };
}
