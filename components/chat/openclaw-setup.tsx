"use client";

import { useEffect, useState } from "react";
import { CopyIcon, ExternalLinkIcon, KeyRoundIcon, Loader2Icon, TerminalSquareIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OpenClawDiagnosticDetails } from "@/components/chat/openclaw-diagnostic-details";
import { CommandBlock } from "@/components/openclaw/command-block";
import {
  OPENCLAW_DEFAULT_BASE,
  OPENCLAW_DEFAULT_BRIDGE,
  type OpenClawGatewaySettings,
  type OpenClawGatewayDiagnostic,
  buildOpenClawDashboardUrl,
  clearOpenClawGatewaySettings,
  generateSuggestedGatewayToken,
  loadOpenClawGatewaySettings,
  loadOpenClawBridgeSettings,
  normalizeGatewayBaseUrl,
  probeOpenClawGateway,
  probeOpenClawBridge,
  saveOpenClawGatewaySettings,
  saveOpenClawBridgeSettings,
} from "@/lib/openclaw-gateway";
import type { OpenClawMode } from "@/lib/openclaw-gateway";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type Props = {
  mode: OpenClawMode;
  onModeChange: (mode: OpenClawMode) => void;
  onGatewaySaved: (settings: OpenClawGatewaySettings) => void;
  onBridgeSaved: (settings: OpenClawGatewaySettings, probeOk: boolean) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function OpenClawSetupDialog({ mode, onModeChange, onGatewaySaved, onBridgeSaved, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,720px)] overflow-y-auto sm:max-w-lg">
        <Tabs value={mode} onValueChange={(v) => onModeChange(v as OpenClawMode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="bridge">
              Local <span className="ml-1 rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">run</span>
            </TabsTrigger>
            <TabsTrigger value="gateway">Gateway</TabsTrigger>
          </TabsList>

          <TabsContent value="bridge">
            <BridgeTab
              open={open}
              onSaved={onBridgeSaved}
              onOpenChange={onOpenChange}
            />
          </TabsContent>

          <TabsContent value="gateway">
            <GatewayTab
              open={open}
              onSaved={onGatewaySaved}
              onOpenChange={onOpenChange}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function BridgeTab({
  open,
  onSaved,
  onOpenChange,
}: {
  open: boolean;
  onSaved: (settings: OpenClawGatewaySettings, probeOk: boolean) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(OPENCLAW_DEFAULT_BRIDGE);
  const [probing, setProbing] = useState(false);
  const [bridgeOk, setBridgeOk] = useState(false);
  const [gatewayModels, setGatewayModels] = useState(0);
  const [currentModel, setCurrentModel] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const s = loadOpenClawBridgeSettings();
      setBaseUrl(s.baseUrl || OPENCLAW_DEFAULT_BRIDGE);
      handleProbe(s.baseUrl || OPENCLAW_DEFAULT_BRIDGE);
    }
  }, [open]);

  async function handleProbe(url: string) {
    setProbing(true);
    setBridgeOk(false);
    try {
      const result = await probeOpenClawBridge(url);
      if (result) {
        setBridgeOk(result.bridge.status === "ok" && result.gateway.ok);
        setGatewayModels(result.gateway.models);
        setCurrentModel(result.model.primary);
      }
    } catch {
      setBridgeOk(false);
    } finally {
      setProbing(false);
    }
  }

  async function handleConnect() {
    const settings: OpenClawGatewaySettings = { baseUrl, token: "" };
    try {
      saveOpenClawBridgeSettings(settings);
      onSaved(settings, bridgeOk);
      toast.success("OpenClaw local conectado!");
      onOpenChange(false);
    } catch {
      toast.error("Erro ao guardar configuração.");
    }
  }

  const runCommand = "npx @model-hub/openclaw-cli run";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TerminalSquareIcon className="size-5" />
          OpenClaw local
        </DialogTitle>
        <DialogDescription>
          O comando <code className="rounded bg-muted px-1 py-0.5 text-[11px]">run</code> inicia a integração local do
          OpenClaw na sua máquina. Funciona mesmo com o ModelHub em produção e atualiza o modelo em tempo real.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <strong>1)</strong> Instale e configure o OpenClaw com <code className="rounded bg-muted px-1 py-0.5">npx @model-hub/openclaw-cli setup</code>
          <br />
          <strong>2)</strong> Inicie a integracao local:
        </div>

        <CommandBlock command={runCommand} copyId="run-start" label="Copiar comando" successMessage="Comando copiado!" />

        <div className="space-y-2">
          <label className="text-sm font-medium">URL local</label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={OPENCLAW_DEFAULT_BRIDGE}
          />
          <p className="text-xs text-muted-foreground">Normalmente {OPENCLAW_DEFAULT_BRIDGE}</p>
        </div>

        {probing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            A verificar integracao local...
          </div>
        ) : !probing && gatewayModels >= 0 ? (
          <div className={`rounded-lg border px-3 py-2 text-xs ${
            bridgeOk
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          }`}>
            {bridgeOk ? (
              <>
                <strong>OK</strong> - OpenClaw local conectado. {gatewayModels} modelos disponíveis
                {currentModel && <> - Modelo: <code className="rounded bg-muted px-1 py-0.5">{currentModel}</code></>}
              </>
            ) : (
              <>Integração local indisponível em <code className="rounded bg-muted px-1 py-0.5">{baseUrl}</code>. Verifique se o comando está em execução no terminal.</>
            )}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" variant="default" disabled={probing} onClick={() => void handleProbe(baseUrl)}>
            {probing ? <Loader2Icon className="mr-1 size-3.5 animate-spin" /> : null}
            {probing ? "A verificar..." : "Verificar conexão"}
          </Button>
          <Button type="button" variant="outline" disabled={probing || !bridgeOk} onClick={() => void handleConnect()}>
            Conectar
          </Button>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A integração local roda na sua máquina e liga o browser ao OpenClaw.
          Sem proxy pelo servidor - funciona mesmo em produção (Vercel). Para o modo manual, use a aba Gateway.
        </p>
      </div>
    </>
  );
}

function GatewayTab({
  open,
  onSaved,
  onOpenChange,
}: {
  open: boolean;
  onSaved: (settings: OpenClawGatewaySettings) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(OPENCLAW_DEFAULT_BASE);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [probeError, setProbeError] = useState<OpenClawGatewayDiagnostic | null>(null);
  const { copy: copyToClipboard } = useCopyToClipboard();

  useEffect(() => {
    if (open) {
      const s = loadOpenClawGatewaySettings();
      setBaseUrl(s.baseUrl || OPENCLAW_DEFAULT_BASE);
      setToken(s.token);
      setProbeError(null);
    }
  }, [open]);

  const normalizedBase = normalizeGatewayBaseUrl(baseUrl);
  const tokenTrimmed = token.trim();
  const openClawDashboardUrl = buildOpenClawDashboardUrl({ baseUrl: normalizedBase, token: tokenTrimmed });
  const handleOpenDashboard = () => {
    if (!openClawDashboardUrl) {
      return;
    }
    window.open(openClawDashboardUrl, "_blank", "noopener,noreferrer");
  };

  const psWithToken = (t: string) =>
    `$env:OPENCLAW_GATEWAY_TOKEN="${t}"\nopenclaw gateway --port 18789`;
  const bashWithToken = (t: string) => `export OPENCLAW_GATEWAY_TOKEN='${t}'\nopenclaw gateway --port 18789`;

  const jsonWithToken = (t: string) => `{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "${t}"
    },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    },
    "port": 18789
  }
}`;

  const jsonWithoutToken = `{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    },
    "port": 18789
  }
}`;

  function ensureToken(): { generated: boolean; token: string } {
    const existing = token.trim();
    if (existing) {
      return { generated: false, token: existing };
    }
    const next = generateSuggestedGatewayToken();
    setToken(next);
    return { generated: true, token: next };
  }

  function copyPowerShell() {
    const { generated, token: t } = ensureToken();
    copyToClipboard("ps", psWithToken(t), generated ? "Comando copiado com token gerado automaticamente." : "Comando PowerShell copiado (com token).");
    if (generated) {
      toast.info("Token preenchido no campo — inicie o gateway e depois Salvar e conectar.", { duration: 5000 });
    }
  }

  function copyBash() {
    const { generated, token: t } = ensureToken();
    copyToClipboard("bash", bashWithToken(t), generated ? "Comando copiado com token gerado automaticamente." : "Comando Bash copiado (com token).");
    if (generated) {
      toast.info("Token preenchido no campo — inicie o gateway e depois Salvar e conectar.", { duration: 5000 });
    }
  }

  function copyJson() {
    const { generated, token: t } = ensureToken();
    copyToClipboard("json", jsonWithToken(t), generated ? "JSON copiado com token gerado automaticamente." : "JSON copiado (com token).");
    if (generated) {
      toast.info("Token preenchido no campo — inicie o gateway e depois Salvar e conectar.", { duration: 5000 });
    }
  }

  async function handleSave() {
    const t = token.trim();
    if (!t) {
      toast.error("Cole o token do gateway (ou gere um e use o mesmo no OpenClaw).");
      return;
    }

    const settings: OpenClawGatewaySettings = {
      baseUrl: normalizedBase,
      token: t,
    };

    setSaving(true);
    setProbeError(null);
    try {
      const result = await probeOpenClawGateway(settings);
      if (!result.ok) {
        setProbeError(result.diagnostic);
        toast.error("O gateway não respondeu como esperado. Veja o diagnóstico abaixo.");
        return;
      }

      try {
        saveOpenClawGatewaySettings(settings);
      } catch {
        toast.error("Não foi possível guardar a configuração (storage do navegador indisponível).");
        return;
      }
      onSaved(settings);
      toast.success("Gateway verificado e guardado neste navegador.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro inesperado ao verificar o gateway.");
    } finally {
      setSaving(false);
    }
  }

  function handleClear() {
    try {
      clearOpenClawGatewaySettings();
    } catch {
      // storage indisponível — prosseguir mesmo assim
    }
    setBaseUrl(OPENCLAW_DEFAULT_BASE);
    setToken("");
    onSaved({ baseUrl: OPENCLAW_DEFAULT_BASE, token: "" });
    toast.success("Configuração local removida.");
    onOpenChange(false);
  }

  function handleSuggestToken() {
    const next = generateSuggestedGatewayToken();
    setToken(next);
    toast.info("Token gerado — use o mesmo no OpenClaw e aqui.", { duration: 4000 });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TerminalSquareIcon className="size-5" />
          OpenClaw no seu computador
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">avançado</span>
        </DialogTitle>
        <DialogDescription>
          Este diálogo configura o <strong>gateway local</strong> do OpenClaw e exige que ele já esteja em
          execução na sua máquina. Para a maioria dos utilizadores, o método recomendado é usar a aba{" "}
          <strong>Local</strong> com o comando <code className="rounded bg-muted px-1 py-0.5 text-[11px]">run</code>.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {probeError ? (
          <Alert variant="destructive">
            <AlertTitle>Diagnóstico</AlertTitle>
            <AlertDescription className="text-sm">
              <OpenClawDiagnosticDetails diagnostic={probeError} />
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <KeyRoundIcon className="mr-1 inline-block size-3.5 text-primary" />
          1) Instale o CLI: <code className="rounded bg-muted px-1 py-0.5">npm install -g openclaw@latest</code>
          <br />
          2) Preencha o token abaixo <strong>ou</strong> use &quot;Copiar comando&quot; — o token é gerado e já vai no
          comando.
          <br />
          3) Cole no terminal, inicie o gateway e clique em <strong>Verificar e guardar</strong>.
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel>URL base do gateway</FieldLabel>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={OPENCLAW_DEFAULT_BASE}
              autoComplete="off"
            />
            <FieldDescription>Normalmente {OPENCLAW_DEFAULT_BASE} — sem <code>/v1</code> no final.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Token (Bearer)</FieldLabel>
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Gerado ao copiar o comando, ou cole o do seu gateway"
              type="password"
              autoComplete="off"
            />
            <FieldDescription>
              Deve ser o mesmo valor de <code className="text-[10px]">OPENCLAW_GATEWAY_TOKEN</code> no terminal.
            </FieldDescription>
          </Field>
        </FieldGroup>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleSuggestToken}>
            Gerar token sugerido
          </Button>
          <Button type="button" variant="default" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2Icon className="mr-1 size-3.5 animate-spin" /> : null}
            {saving ? "A verificar gateway…" : "Verificar e guardar"}
          </Button>
          <Button type="button" variant="outline" onClick={handleClear}>
            Limpar
          </Button>
        </div>

        {openClawDashboardUrl ? (
          <Button className="w-full gap-2 text-xs" size="sm" type="button" variant="outline" onClick={handleOpenDashboard}>
            <ExternalLinkIcon className="size-3.5" />
            Abrir painel OpenClaw (chat nativo)
          </Button>
        ) : null}

        <Tabs defaultValue="powershell" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="powershell">PowerShell</TabsTrigger>
            <TabsTrigger value="bash">Bash / macOS / Linux</TabsTrigger>
          </TabsList>
          <TabsContent value="powershell" className="mt-2 space-y-2">
            <pre className="max-h-36 overflow-x-auto overflow-y-auto rounded-md border bg-muted/50 p-3 text-[11px] leading-relaxed">
              {tokenTrimmed
                ? psWithToken(tokenTrimmed)
                : `$env:OPENCLAW_GATEWAY_TOKEN="<token ao clicar em Copiar>"\nopenclaw gateway --port 18789`}
            </pre>
            <Button type="button" variant="outline" size="sm" className="w-full gap-2 text-xs" onClick={copyPowerShell}>
              <CopyIcon className="size-3.5" />
              Copiar comando (token incluído)
            </Button>
          </TabsContent>
          <TabsContent value="bash" className="mt-2 space-y-2">
            <pre className="max-h-36 overflow-x-auto overflow-y-auto rounded-md border bg-muted/50 p-3 text-[11px] leading-relaxed">
              {tokenTrimmed
                ? bashWithToken(tokenTrimmed)
                : `export OPENCLAW_GATEWAY_TOKEN='<token ao clicar em Copiar>'\nopenclaw gateway --port 18789`}
            </pre>
            <Button type="button" variant="outline" size="sm" className="w-full gap-2 text-xs" onClick={copyBash}>
              <CopyIcon className="size-3.5" />
              Copiar comando (token incluído)
            </Button>
          </TabsContent>
        </Tabs>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Trecho opcional para ~/.openclaw/openclaw.json</p>
          <pre className="max-h-28 overflow-auto rounded-md border bg-muted/50 p-2 text-[10px] leading-relaxed">
            {tokenTrimmed
              ? jsonWithToken(tokenTrimmed)
              : jsonWithoutToken}
          </pre>
          <Button type="button" variant="ghost" size="sm" className="h-8 w-full text-xs" onClick={copyJson}>
            <CopyIcon className="mr-1 size-3" />
            Copiar JSON (token incluído)
          </Button>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          O verificador do ModelHub usa o servidor da app (sem CORS). O painel oficial abre em nova aba; não pode ser
          embutido aqui (X-Frame-Options no gateway).
        </p>
      </div>
    </>
  );
}
