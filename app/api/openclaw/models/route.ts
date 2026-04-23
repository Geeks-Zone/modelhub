import { fetchOpenClawGatewayModelsFromServer } from "@/lib/openclaw-probe-server";
import type { OpenClawGatewaySettings } from "@/lib/openclaw-gateway";
import { parseOpenClawProxyBody } from "@/lib/openclaw-proxy-body";

export async function POST(request: Request) {
  const { body, error } = await parseOpenClawProxyBody(request);
  if (error) return error;

  const settings: OpenClawGatewaySettings = { baseUrl: body.baseUrl, token: body.token };
  return fetchOpenClawGatewayModelsFromServer(settings);
}