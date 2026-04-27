"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ExternalLinkIcon,
  InfoIcon,
  KeyRoundIcon,
  ServerIcon,
  TerminalSquareIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { CommandBlock } from "@/components/openclaw/command-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
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
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <TerminalSquareIcon className="size-4 text-muted-foreground" />
            Usar no OpenClaw
          </DialogTitle>
          <DialogDescription>
            Configure o OpenClaw para usar o ModelHub como gateway OpenAI-compatible. O OpenClaw chama nosso servidor,
            autentica com sua API key do ModelHub e usa os modelos do nosso catálogo.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(85vh-9.5rem)] space-y-5 overflow-y-auto px-5 py-4">
          {hasApiKey ? (
            <Alert>
              <InfoIcon />
              <AlertTitle>Use uma API key ativa</AlertTitle>
              <AlertDescription>
                Por segurança, a chave completa só é exibida quando criada. Substitua{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">SUA_API_KEY</code> por uma chave ativa do ModelHub.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Você ainda não tem uma API key</AlertTitle>
              <AlertDescription>
                Gere uma chave no Dashboard antes de continuar e use no lugar de{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">SUA_API_KEY</code>.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <InfoTile icon={<ServerIcon className="size-3.5" />} label="Servidor" value={commands.apiBaseUrl} />
            <InfoTile icon={<KeyRoundIcon className="size-3.5" />} label="API key" value="SUA_API_KEY" />
            <InfoTile
              icon={<TerminalSquareIcon className="size-3.5" />}
              label="Modelo OpenClaw"
              value={commands.modelRef}
            />
          </div>

          <div className="space-y-4">
            <Step number={1} title="Instale o OpenClaw" description="Caso ainda não esteja instalado nesta máquina.">
              <CommandBlock command={commands.install} copyId="openclaw-guide-install" label="Copiar instalação" />
            </Step>

            <Step
              number={2}
              title="Aponte o OpenClaw para o ModelHub"
              description="Cria o provider modelhub no OpenClaw, aponta para nosso servidor e define o modelo padrão."
            >
              <CommandBlock
                command={commands.setup()}
                copyId="openclaw-guide-setup"
                label="Copiar setup"
                successMessage="Comando de setup copiado!"
              />
            </Step>

            <Step
              number={3}
              title="Confira os modelos disponíveis"
              description="Lista o catálogo já filtrado pela sua conta e pelas credenciais que você configurou."
            >
              <CommandBlock
                command={commands.models()}
                copyId="openclaw-guide-models"
                label="Copiar models"
                successMessage="Comando de modelos copiado!"
              />
            </Step>

            <Step
              number={4}
              title="Use o OpenClaw normalmente"
              description="Para trocar o modelo padrão depois do setup, rode:"
            >
              <CommandBlock command={commands.model} copyId="openclaw-guide-model" label="Copiar troca de modelo" />
            </Step>
          </div>

          <Separator />

          <section className="space-y-2">
            <div className="space-y-1">
              <p className="text-sm font-medium">Configuração manual equivalente</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Se preferir editar <code className="rounded bg-muted px-1 py-0.5 text-[11px]">~/.openclaw/openclaw.json</code>{" "}
                diretamente, este é o formato mínimo. O CLI acima gera uma versão completa com aliases e metadados.
              </p>
            </div>
            <CommandBlock
              command={configSnippet}
              copyId="openclaw-guide-config"
              label="Copiar configuração JSON"
              successMessage="Configuração copiada!"
            />
          </section>
        </div>

        <DialogFooter className="m-0 rounded-none border-t bg-muted/40 px-5 py-3">
          <DialogClose asChild>
            <Button variant="ghost">Fechar</Button>
          </DialogClose>
          <Button asChild>
            <Link href="/dashboard">
              <ExternalLinkIcon data-icon="inline-start" />
              Abrir Dashboard
            </Link>
          </Button>
        </DialogFooter>
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
    <div className="min-w-0 rounded-lg border bg-muted/40 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        {label}
      </p>
      <code className="mt-1 block truncate text-xs text-foreground" title={value}>
        {value}
      </code>
    </div>
  );
}

function Step({
  children,
  description,
  number,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly number: number;
  readonly title: string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {number}
      </div>
      <div className="min-w-0 space-y-2">
        <div className="space-y-0.5">
          <p className="text-sm font-medium leading-tight">{title}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
