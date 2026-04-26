import { NextResponse } from "next/server";

const ALLOWED_MODES = new Set(["bridge", "gateway"]);
const ACTION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido." }, { status: 400 });
  }

  const mode = typeof (body as { mode?: unknown })?.mode === "string" ? (body as { mode: string }).mode : "";
  const action = typeof (body as { action?: unknown })?.action === "string" ? (body as { action: string }).action : "";

  if (!ALLOWED_MODES.has(mode) || !ACTION_PATTERN.test(action)) {
    return NextResponse.json({ error: "Evento OpenClaw inválido." }, { status: 400 });
  }

  console.info(
    `[openclaw-usage] ${JSON.stringify({
      action,
      mode,
    })}`,
  );

  return NextResponse.json({ ok: true });
}
