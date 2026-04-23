import { NextResponse } from "next/server";

import { runOpenClawProbeFromServer } from "@/lib/openclaw-probe-server";
import { parseOpenClawProxyBody } from "@/lib/openclaw-proxy-body";

export async function POST(request: Request) {
  const { body, error } = await parseOpenClawProxyBody(request);
  if (error) {
    return NextResponse.json(
      { diagnostic: { steps: [], summary: "Corpo JSON inválido." }, ok: false },
      { status: 400 },
    );
  }

  const result = await runOpenClawProbeFromServer(body);
  return NextResponse.json(result);
}