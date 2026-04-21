"use client";

import { useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  MonitorSmartphoneIcon,
  TerminalSquareIcon,
} from "lucide-react";
import { DEFAULT_MODEL_ID } from "@/lib/defaults";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const MODELHUB_BASE_URL = "https://www.modelhub.com.br";

type WizardStep = "install" | "connect" | "verify" | "model";

type StepDefinition = {
  description: string;
  id: WizardStep;
  label: string;
};

const STEPS: StepDefinition[] = [
  { id: "install", label: "Instalar", description: "Instale o OpenClaw na sua máquina." },
  { id: "connect", label: "Conectar", description: "Copie o comando de setup com sua API key." },
  { id: "verify", label: "Verificar", description: "Valide se tudo está funcionando." },
  { id: "model", label: "Modelo", description: "Escolha o modelo padrão." },
];

type OsTab = "macos" | "linux" | "windows";

const installCommands: Record<OsTab, string> = {
  windows: "npm install -g openclaw@latest",
  macos: "npm install -g openclaw@latest",
  linux: "npm install -g openclaw@latest",
};

const osLabels: Record<OsTab, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

export function OpenClawWizard({
  apiKey,
  hasApiKey,
  onCreateKey,
}: {
  apiKey: string | null;
  hasApiKey: boolean;
  onCreateKey: () => void;
}) {
  const [activeStep, setActiveStep] = useState<WizardStep>("install");
  const [activeOs, setActiveOs] = useState<OsTab>("macos");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const resolvedKey = apiKey ?? "SUA_API_KEY";

  const connectCommand = `npx @model-hub/openclaw-cli setup --base-url ${MODELHUB_BASE_URL} --api-key ${resolvedKey} --model ${DEFAULT_MODEL_ID}`;
  const verifyCommand = `npx @model-hub/openclaw-cli doctor --base-url ${MODELHUB_BASE_URL} --api-key ${resolvedKey} --model ${DEFAULT_MODEL_ID}`;
  const modelCommand = `npx @model-hub/openclaw-cli use ${DEFAULT_MODEL_ID}`;

  function handleCopy(id: string, text: string, successMsg: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      toast.success(successMsg);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    }).catch(() => {
      toast.error("Falha ao copiar.");
    });
  }

  const stepIndex = STEPS.findIndex((s) => s.id === activeStep);

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

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {STEPS.map((step, idx) => (
          <button
            key={step.id}
            onClick={() => setActiveStep(step.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
              activeStep === step.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className={`flex size-5 items-center justify-center rounded-full text-[10px] font-bold ${
              idx < stepIndex
                ? "bg-primary/10 text-primary"
                : activeStep === step.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted-foreground/10 text-muted-foreground"
            }`}>
              {idx < stepIndex ? <CheckIcon className="size-3" /> : idx + 1}
            </span>
            <span className="hidden sm:inline">{step.label}</span>
          </button>
        ))}
      </div>

      {activeStep === "install" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 1 de 4 — Instale o OpenClaw</p>
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
                  activeOs === os
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <MonitorSmartphoneIcon className="mr-1 inline size-3" />
                {osLabels[os]}
              </button>
            ))}
          </div>

          <div className="group relative">
            <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
              <code>{installCommands[activeOs]}</code>
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => handleCopy("install", installCommands[activeOs], "Comando de instalação copiado!")}
            >
              {copiedId === "install" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={() => handleCopy("install-btn", installCommands[activeOs], "Comando de instalação copiado!")}>
            {copiedId === "install-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            Copiar comando
          </Button>

          <Button variant="link" size="sm" asChild className="h-auto p-0">
            <a href="https://www.npmjs.com/package/openclaw" target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon className="mr-1 size-3" />
              Ver pacote no npm
            </a>
          </Button>
        </div>
      )}

      {activeStep === "connect" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 2 de 4 — Conecte ao ModelHub</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Copie o comando abaixo e rode no terminal. Ele configura o OpenClaw para usar o ModelHub
              como provider, sincroniza o catálogo e define o modelo recomendado.
            </p>
          </div>

          <div className="group relative">
            <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
              <code>{connectCommand}</code>
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => handleCopy("connect", connectCommand, "Comando de setup copiado!")}
            >
              {copiedId === "connect" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={() => handleCopy("connect-btn", connectCommand, "Comando de setup copiado!")}>
            {copiedId === "connect-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            Copiar setup
          </Button>
        </div>
      )}

      {activeStep === "verify" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 3 de 4 — Verifique a integração</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Rode o comando <code className="rounded bg-muted px-1 py-0.5">doctor</code> para validar que o OpenClaw
              está conectado ao ModelHub, o catálogo carregou e o endpoint de chat está respondendo.
            </p>
          </div>

          <div className="group relative">
            <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
              <code>{verifyCommand}</code>
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => handleCopy("verify", verifyCommand, "Comando doctor copiado!")}
            >
              {copiedId === "verify" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={() => handleCopy("verify-btn", verifyCommand, "Comando doctor copiado!")}>
            {copiedId === "verify-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            Copiar doctor
          </Button>
        </div>
      )}

      {activeStep === "model" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Passo 4 de 4 — Escolha o modelo padrão</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              O setup já define o modelo recomendado automaticamente. Use este comando para trocar
              sempre que quiser. Veja os modelos disponíveis com{" "}
              <code className="rounded bg-muted px-1 py-0.5">npx @model-hub/openclaw-cli models</code>.
            </p>
          </div>

          <div className="group relative">
            <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
              <code>{modelCommand}</code>
            </pre>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => handleCopy("model", modelCommand, "Comando copiado!")}
            >
              {copiedId === "model" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={() => handleCopy("model-btn", modelCommand, "Comando copiado!")}>
            {copiedId === "model-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            Copiar comando
          </Button>
        </div>
      )}
    </div>
  );
}