"use client";

import { useState } from "react";
import { MonitorSmartphoneIcon, TerminalSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandBlock } from "@/components/openclaw/command-block";
import { OpenClawStepIndicator } from "@/components/openclaw/step-indicator";
import { useOpenClawCommands } from "@/lib/use-openclaw-commands";

type WizardStep = "install" | "connect" | "verify" | "sync" | "model";

const STEPS: { description: string; id: WizardStep; label: string }[] = [
  { id: "install", label: "Instalar", description: "Instale o OpenClaw na sua máquina." },
  { id: "connect", label: "Conectar", description: "Copie o comando de setup com sua API key." },
  { id: "verify", label: "Verificar", description: "Valide se tudo está funcionando." },
  { id: "sync", label: "Sincronizar", description: "Puxe config completo com fallbacks e aliases." },
  { id: "model", label: "Modelo", description: "Escolha o modelo padrão." },
];

type OsTab = "macos" | "linux" | "windows";

const installCommands: Record<OsTab, string> = {
  windows: "npm install -g openclaw@latest",
  macos: "npm install -g openclaw@latest",
  linux: "npm install -g openclaw@latest",
};

const osLabels: Record<OsTab, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

export function OpenClawWizard({
  apiKey,
  hasApiKey,
  onCreateKey,
}: {
  readonly apiKey: string | null;
  readonly hasApiKey: boolean;
  readonly onCreateKey: () => void;
}) {
  const [activeStep, setActiveStep] = useState<WizardStep>("install");
  const [activeOs, setActiveOs] = useState<OsTab>("macos");
  const commands = useOpenClawCommands({ apiKey });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <TerminalSquareIcon className="size-4 text-primary" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Integrar com OpenClaw (opcional)</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Siga os passos abaixo para conectar o OpenClaw ao ModelHub. Cada passo tem
            um comando pronto para copiar.
          </p>
        </div>
      </div>

      {!hasApiKey && !apiKey && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-muted-foreground">
          Crie uma API key primeiro para copiar os comandos com tudo preenchido automaticamente.{" "}
          <Button variant="link" size="sm" className="h-auto p-0 text-amber-600 dark:text-amber-400" onClick={onCreateKey}>
            Criar key
          </Button>
        </div>
      )}

      {!apiKey && hasApiKey && (
        <div className="rounded-xl border border-border/60 bg-background/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Seus comandos usarão <code className="rounded bg-muted px-1 py-0.5">SUA_API_KEY</code> como placeholder.
          Gere uma nova key para copiar tudo preenchido.
        </div>
      )}

      <OpenClawStepIndicator steps={STEPS} activeStep={activeStep} onStepChange={setActiveStep} />

      {activeStep === "install" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 1 de 5 — Instale o OpenClaw</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              O OpenClaw é um assistente de IA local. Instale uma vez e use no terminal. Requer Node.js 22+.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            {(Object.keys(installCommands) as OsTab[]).map((os) => (
              <button
                key={os}
                onClick={() => setActiveOs(os)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeOs === os ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MonitorSmartphoneIcon className="mr-1 inline size-3" />
                {osLabels[os]}
              </button>
            ))}
          </div>

          <CommandBlock command={installCommands[activeOs]} copyId="wizard-install" label="Copiar comando" />
        </div>
      )}

      {activeStep === "connect" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 2 de 5 — Conecte ao ModelHub</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Copie o comando abaixo e rode no terminal. Ele configura o OpenClaw para usar o ModelHub
              como provider, sincroniza o catálogo e define o modelo recomendado.
            </p>
          </div>
          <CommandBlock command={commands.setup()} copyId="wizard-connect" label="Copiar setup" successMessage="Comando de setup copiado!" />
        </div>
      )}

      {activeStep === "verify" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 3 de 5 — Verifique a integração</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Rode o comando <code className="rounded bg-muted px-1 py-0.5">doctor</code> para validar que o OpenClaw
              está conectado ao ModelHub, o catálogo carregou e o endpoint de chat está respondendo.
            </p>
          </div>
          <CommandBlock command={commands.verify()} copyId="wizard-verify" label="Copiar doctor" successMessage="Comando doctor copiado!" />
        </div>
      )}

      {activeStep === "sync" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 4 de 5 — Sincronize config completo</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              O <code className="rounded bg-muted px-1 py-0.5">sync</code> puxa do servidor o config com{' '}
              <strong>fallbacks</strong> (modelos alternativos), <strong>aliases</strong> (nomes curtos) e{' '}
              <strong>contextWindow</strong>. A API key fica como env var <code className="rounded bg-muted px-1 py-0.5">{"${MODELHUB_API_KEY}"}</code>.
            </p>
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Certifique-se de exportar <code className="rounded bg-muted px-1 py-0.5">MODELHUB_API_KEY</code> no seu
              shell para que o OpenClaw resolva a env var no config.
            </div>
          </div>
          <CommandBlock command={commands.sync()} copyId="wizard-sync" label="Copiar sync" successMessage="Comando sync copiado!" />
        </div>
      )}

      {activeStep === "model" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 5 de 5 — Escolha o modelo padrão</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              O setup já define o modelo recomendado automaticamente. Use este comando para trocar
              sempre que quiser. Veja os modelos disponíveis com{" "}
              <code className="rounded bg-muted px-1 py-0.5">npx @model-hub/openclaw-cli models</code>.
            </p>
          </div>
          <CommandBlock command={commands.model} copyId="wizard-model" label="Copiar comando" />
        </div>
      )}
    </div>
  );
}