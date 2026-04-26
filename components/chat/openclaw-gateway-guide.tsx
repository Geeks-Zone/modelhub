"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLinkIcon, KeyRoundIcon, ServerIcon, TerminalSquareIcon } from "lucide-react";

import { CommandBlock } from "@/components/openclaw/command-block";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEFAULT_MODEL_ID } from "@/lib/defaults";
import { useOpenClawCommands } from "@/lib/use-openclaw-commands";

type Props = {
  readonly hasApiKey: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

export function OpenClawGatewayGuideDialog({ hasApiKey, open, onOpenChange }: Props) {
  const commands = useOpenClawCommands();
  const configSnippet = `{
  "agents": {
    "defaults": {
      "model": {
        "primary": "${commands.modelRef}"
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "modelhub": {
        "api": "openai-completions",
        "apiKey": "SUA_API_KEY",
        "baseUrl": "${commands.apiBaseUrl}",
        "models": [
          {
            "id": "${DEFAULT_MODEL_ID}",
            "name": "${DEFAULT_MODEL_ID}"
          }
        ]
      }
    }
  }
}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(90vh,760px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalSquareIcon className="size-5" />
            Usar no OpenClaw
          </DialogTitle>
          <DialogDescription>
            Configure o OpenClaw para usar o ModelHub como gateway OpenAI-compatible. O OpenClaw chama nosso servidor,
            autentica com sua API key do ModelHub e usa os modelos do nosso catálogo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-3">
            <InfoTile icon={<ServerIcon className="size-3.5" />} label="Servidor" value={commands.apiBaseUrl} />
            <InfoTile icon={<KeyRoundIcon className="size-3.5" />} label="API key" value="SUA_API_KEY" />
            <InfoTile icon={<TerminalSquareIcon className="size-3.5" />} label="Modelo OpenClaw" value={commands.modelRef} />
          </div>

          {!hasApiKey ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
              Você ainda não tem uma API key ativa. Gere uma chave no Dashboard e use no lugar de{" "}
              <code className="rounded bg-background/70 px-1 py-0.5">SUA_API_KEY</code>.
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Por segurança, a chave completa só aparece quando é criada. Use uma API key ativa do ModelHub no comando.
            </div>
          )}

          <GuideStep
            title="1. Instale o OpenClaw"
            description="Se o OpenClaw ainda não estiver instalado nesta máquina, instale uma vez com npm."
          >
            <CommandBlock command={commands.install} copyId="openclaw-guide-install" label="Copiar instalação" />
          </GuideStep>

          <GuideStep
            title="2. Aponte o OpenClaw para o ModelHub"
            description="Este comando cria o provider modelhub no OpenClaw, aponta para nosso servidor e define o modelo padrão."
          >
            <CommandBlock
              command={commands.setup()}
              copyId="openclaw-guide-setup"
              label="Copiar setup"
              successMessage="Comando de setup copiado!"
            />
          </GuideStep>

          <GuideStep
            title="3. Confira os modelos disponíveis"
            description="Liste o catálogo já filtrado pela sua conta e pelas credenciais de providers que você configurou no ModelHub."
          >
            <CommandBlock
              command={commands.models()}
              copyId="openclaw-guide-models"
              label="Copiar models"
              successMessage="Comando de modelos copiado!"
            />
          </GuideStep>

          <GuideStep
            title="4. Use o OpenClaw normalmente"
            description="Depois do setup, o OpenClaw usa o provider modelhub. Para trocar o modelo padrão, rode:"
          >
            <CommandBlock command={commands.model} copyId="openclaw-guide-model" label="Copiar troca de modelo" />
          </GuideStep>

          <div className="space-y-2 rounded-lg border border-border/60 bg-background px-3 py-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Configuração manual equivalente</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Se preferir editar <code className="rounded bg-muted px-1 py-0.5">~/.openclaw/openclaw.json</code>,
                este é o formato mínimo. O CLI acima gera uma versão completa com aliases e metadados.
              </p>
            </div>
            <CommandBlock
              command={configSnippet}
              copyId="openclaw-guide-config"
              label="Copiar config"
              successMessage="Configuração copiada!"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Use <code className="rounded bg-muted px-1 py-0.5">SUA_API_KEY</code> como a chave da sua conta ModelHub,
              não como chave direta de OpenAI, Anthropic ou outro provider.
            </p>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href="/dashboard">
                <ExternalLinkIcon data-icon="inline-start" />
                Abrir Dashboard
              </Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <code className="mt-1 block truncate text-xs">{value}</code>
    </div>
  );
}

function GuideStep({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}
