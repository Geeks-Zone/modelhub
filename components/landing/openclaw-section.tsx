"use client";

import { useState } from "react";
import { BotIcon, ExternalLinkIcon } from "lucide-react";
import { AuthButtons } from "@/components/landing/auth-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CommandBlock } from "@/components/openclaw/command-block";
import { OpenClawStepIndicator } from "@/components/openclaw/step-indicator";
import { useOpenClawCommands } from "@/lib/use-openclaw-commands";

type StepId = "install" | "connect" | "verify" | "sync" | "model";

const steps: { description: string; id: StepId; label: string }[] = [
  { id: "install", label: "Instalar", description: "Instale uma vez na sua máquina com npm." },
  { id: "connect", label: "Conectar", description: "Copie o comando de setup com sua API key." },
  { id: "verify", label: "Verificar", description: "Rode o doctor para validar a integração." },
  { id: "sync", label: "Sincronizar", description: "Puxe config completo com fallbacks e aliases." },
  { id: "model", label: "Escolher", description: "Troque o modelo padrão quando quiser." },
];

export function OpenClawSection({ apiKey }: { apiKey?: string | null }) {
  const [activeStep, setActiveStep] = useState<StepId>("install");
  const commands = useOpenClawCommands(apiKey);

  return (
    <section className="border-y border-border/60 bg-muted/30 px-6 py-16 md:py-24">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs">
            <BotIcon className="size-3" />
            Integração opcional: OpenClaw
          </Badge>
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Quer usar no terminal? Integre com o OpenClaw
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            O ModelHub já funciona no browser e pela API. Se quiser um assistente local no terminal,
            siga os 4 passos abaixo — cada um com comando pronto para copiar.
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background p-5 shadow-sm">
          <OpenClawStepIndicator steps={steps} activeStep={activeStep} onStepChange={setActiveStep} />

          <div className="mt-4 space-y-3">
            {activeStep === "install" && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Passo 1 — Instale o OpenClaw</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Requer Node.js 22+. O OpenClaw é um assistente de IA local para o terminal.
                  </p>
                </div>
                <CommandBlock command={commands.install} copyId="landing-install" label="Copiar comando" />
              </>
            )}

            {activeStep === "connect" && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Passo 2 — Conecte ao ModelHub</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Crie uma API key na área logada e copie o comando pronto. Ele configura o OpenClaw,
                    sincroniza o catálogo e define o modelo recomendado — tudo em um comando.
                  </p>
                </div>
                <CommandBlock
                  command={commands.setup()}
                  copyId="landing-connect"
                  label="Copiar setup"
                  successMessage="Comando de setup copiado!"
                />
                <div className="flex flex-wrap gap-2">
                  <AuthButtons size="sm" />
                </div>
              </>
            )}

            {activeStep === "verify" && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Passo 3 — Verifique a integração</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Rode o doctor para validar que o OpenClaw está conectado ao ModelHub e o endpoint de
                    chat está respondendo.
                  </p>
                </div>
                <CommandBlock
                  command={commands.verify()}
                  copyId="landing-verify"
                  label="Copiar doctor"
                  successMessage="Comando doctor copiado!"
                />
              </>
            )}

            {activeStep === "sync" && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Passo 4 — Sincronize config completo</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    O <code className="rounded bg-muted px-1 py-0.5">sync</code> puxa do servidor o config com
                    <strong>fallbacks</strong>, <strong>aliases</strong> e <strong>contextWindow</strong>.
                    A API key fica como env var <code className="rounded bg-muted px-1 py-0.5">{"${MODELHUB_API_KEY}"}</code>.
                  </p>
                </div>
                <CommandBlock
                  command={commands.sync()}
                  copyId="landing-sync"
                  label="Copiar sync"
                  successMessage="Comando sync copiado!"
                />
              </>
            )}

            {activeStep === "model" && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Passo 5 — Escolha o modelo padrão</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    O setup já define um modelo recomendado. Use este comando para trocar quando quiser.
                    Liste todos com{" "}
                    <code className="rounded bg-muted px-1 py-0.5">npx @model-hub/openclaw-cli models</code>.
                  </p>
                </div>
                <CommandBlock command={commands.model} copyId="landing-model" label="Copiar comando" />
              </>
            )}
          </div>

          <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs leading-relaxed text-muted-foreground">
            O ModelHub funciona sem o OpenClaw pela web app e pela API OpenAI-compatible. A integração
            com OpenClaw é opcional e serve para quem quer rodar o assistente localmente.
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <AuthButtons size="lg" />
          <Button asChild variant="outline" size="lg">
            <a href="https://www.npmjs.com/package/@model-hub/openclaw-cli" target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              Ver pacote npm
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}