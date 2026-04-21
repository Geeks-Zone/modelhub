"use client";

import { useState } from "react";
import { BotIcon, CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { AuthButtons } from "@/components/landing/auth-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_MODEL_ID } from "@/lib/defaults";

const MODELHUB_BASE_URL = "https://www.modelhub.com.br";

type StepId = "install" | "connect" | "verify" | "model";

const steps: { description: string; id: StepId; title: string }[] = [
  { id: "install", title: "Instalar OpenClaw", description: "Instale uma vez na sua máquina com npm." },
  { id: "connect", title: "Conectar ao ModelHub", description: "Copie o comando de setup com sua API key." },
  { id: "verify", title: "Verificar", description: "Rode o doctor para validar a integração." },
  { id: "model", title: "Escolher modelo", description: "Troque o modelo padrão quando quiser." },
];

export function OpenClawSection() {
  const [activeStep, setActiveStep] = useState<StepId>("install");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  function handleCopy(id: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    });
  }

  const installCommand = "npm install -g openclaw@latest";
const connectCommand = `npx @model-hub/openclaw-cli setup --base-url ${MODELHUB_BASE_URL} --api-key SUA_API_KEY --model ${DEFAULT_MODEL_ID}`;
const verifyCommand = `npx @model-hub/openclaw-cli doctor --base-url ${MODELHUB_BASE_URL} --api-key SUA_API_KEY --model ${DEFAULT_MODEL_ID}`;
  const modelCommand = `npx @model-hub/openclaw-cli use ${DEFAULT_MODEL_ID}`;

  const stepIndex = steps.findIndex((s) => s.id === activeStep);

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
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {steps.map((step, idx) => (
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
                <span className="hidden sm:inline">{step.title}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            {activeStep === "install" && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Passo 1 — Instale o OpenClaw</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Requer Node.js 22+. O OpenClaw é um assistente de IA local para o terminal.
                  </p>
                </div>
                <div className="group relative">
                  <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
                    <code>{installCommand}</code>
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => handleCopy("landing-install", installCommand)}
                  >
                    {copiedId === "landing-install" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleCopy("landing-install-btn", installCommand)}>
                  {copiedId === "landing-install-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                  {copiedId === "landing-install-btn" ? "Copiado" : "Copiar comando"}
                </Button>
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
                <div className="group relative">
                  <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
                    <code>{connectCommand}</code>
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => handleCopy("landing-connect", connectCommand)}
                  >
                    {copiedId === "landing-connect" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleCopy("landing-connect-btn", connectCommand)}>
                    {copiedId === "landing-connect-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                    {copiedId === "landing-connect-btn" ? "Copiado" : "Copiar setup"}
                  </Button>
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
                <div className="group relative">
                  <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
                    <code>{verifyCommand}</code>
                  </pre>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => handleCopy("landing-verify", verifyCommand)}
                  >
                    {copiedId === "landing-verify" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleCopy("landing-verify-btn", verifyCommand)}>
                  {copiedId === "landing-verify-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                  {copiedId === "landing-verify-btn" ? "Copiado" : "Copiar doctor"}
                </Button>
              </>
            )}

            {activeStep === "model" && (
              <>
                <div className="space-y-1">
                  <p className="text-sm font-medium">Passo 4 — Escolha o modelo padrão</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    O setup já define um modelo recomendado. Use este comando para trocar quando quiser.
                    Liste todos com <code className="rounded bg-muted px-1 py-0.5">npx @model-hub/openclaw-cli models</code>.
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
                    onClick={() => handleCopy("landing-model", modelCommand)}
                  >
                    {copiedId === "landing-model" ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleCopy("landing-model-btn", modelCommand)}>
                  {copiedId === "landing-model-btn" ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                  {copiedId === "landing-model-btn" ? "Copiado" : "Copiar comando"}
                </Button>
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