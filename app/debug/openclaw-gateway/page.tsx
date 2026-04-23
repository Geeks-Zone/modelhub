"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLinkIcon, Loader2Icon, PlayIcon } from "lucide-react";

import { OpenClawDiagnosticDetails } from "@/components/chat/openclaw-diagnostic-details";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OPENCLAW_DEFAULT_BASE,
  buildOpenClawDashboardUrl,
  loadOpenClawGatewaySettings,
  probeOpenClawGateway,
  type OpenClawGatewayProbeResult,
} from "@/lib/openclaw-gateway";

export default function DebugOpenclawGatewayPage() {
  const [baseUrl, setBaseUrl] = useState(OPENCLAW_DEFAULT_BASE);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OpenClawGatewayProbeResult | null>(null);

  useEffect(() => {
    const s = loadOpenClawGatewaySettings();
    setBaseUrl(s.baseUrl || OPENCLAW_DEFAULT_BASE);
    setToken(s.token);
  }, []);

  async function runProbe() {
    setLoading(true);
    setResult(null);
    try {
      const r = await probeOpenClawGateway({ baseUrl: baseUrl.trim(), token: token.trim() });
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  const dashboardUrl = buildOpenClawDashboardUrl({ baseUrl: baseUrl.trim(), token: token.trim() });

  return (
    <div className="mx-auto min-h-svh max-w-lg px-4 py-10">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl">Diagnóstico — Gateway OpenClaw</CardTitle>
          <CardDescription>
            Testa a <strong>API HTTP</strong> <code className="text-xs">GET /v1/models</code> (igual ao chat). Não é
            a ligação WebSocket do painel em <code className="text-xs">/chat</code> — se lá aparecer «token missing»,
            cole o mesmo token no painel OpenClaw ou use <code className="text-xs">openclaw dashboard</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ocg-base">URL base</Label>
            <Input
              id="ocg-base"
              autoComplete="off"
              placeholder={OPENCLAW_DEFAULT_BASE}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Sem <code>/v1</code> no fim. Apenas loopback (127.0.0.1, localhost).</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ocg-token">Token (Bearer)</Label>
            <Input
              id="ocg-token"
              autoComplete="off"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="OPENCLAW_GATEWAY_TOKEN"
            />
          </div>
          <Button className="w-full gap-2" disabled={loading} type="button" onClick={() => void runProbe()}>
            {loading ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
            {loading ? "A testar…" : "Testar ligação"}
          </Button>

          {dashboardUrl ? (
            <Button asChild className="w-full gap-2" type="button" variant="outline">
              <a href={dashboardUrl} rel="noopener noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Abrir painel OpenClaw (chat nativo)
              </a>
            </Button>
          ) : null}

          {result ? (
            result.ok ? (
              <Alert className="border-emerald-500/40 bg-emerald-500/10">
                <AlertTitle className="text-emerald-800 dark:text-emerald-200">OK</AlertTitle>
                <AlertDescription className="text-emerald-900/90 dark:text-emerald-100/90">
                  O gateway respondeu com JSON válido em <code className="text-xs">/v1/models</code> (lista OpenAI).
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive">
                <AlertTitle>Falha</AlertTitle>
                <AlertDescription>
                  <OpenClawDiagnosticDetails className="pt-1" diagnostic={result.diagnostic} />
                </AlertDescription>
              </Alert>
            )
          ) : null}

          <p className="text-center text-xs text-muted-foreground">
            <Link className="underline underline-offset-2 hover:text-foreground" href="/chat">
              Voltar ao chat
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}