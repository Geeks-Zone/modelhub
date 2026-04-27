"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon,
  ServerIcon,
  TerminalSquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { CommandBlock } from "@/components/openclaw/command-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiJson, apiJsonRequest } from "@/lib/api";
import type { ApiKeySummary } from "@/lib/contracts";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { useOpenClawCommands } from "@/lib/use-openclaw-commands";

type Props = {
  readonly currentModelId: string | null;
  readonly currentModelLabel: string | null;
  readonly currentProviderLabel: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
};

type GeneratedKey = {
  id: string;
  label: string;
  prefix: string;
  raw: string;
};

export function OpenClawGatewayGuideDialog({
  currentModelId,
  currentModelLabel,
  currentProviderLabel,
  open,
  onOpenChange,
}: Props) {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [generatedKey, setGeneratedKey] = useState<GeneratedKey | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const { copiedId, copy } = useCopyToClipboard();

  useEffect(() => {
    if (!open) {
      setGeneratedKey(null);
      return;
    }
    let cancelled = false;
    setLoadingKeys(true);
    apiJson<{ keys: ApiKeySummary[] }>("/user/api-keys")
      .then((payload) => {
        if (cancelled) return;
        setKeys(payload.keys ?? []);
        setSelectedKeyId((current) => {
          if (current && payload.keys?.some((k) => k.id === current)) return current;
          return payload.keys?.[0]?.id ?? "";
        });
      })
      .catch(() => {
        if (cancelled) return;
        setKeys([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingKeys(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleGenerateKey = useCallback(async () => {
    setCreatingKey(true);
    try {
      const created = await apiJsonRequest<{
        id: string;
        prefix: string;
        label: string;
        apiKey: string;
      }>("/user/api-keys", "POST", { label: `openclaw ${new Date().toISOString().slice(0, 10)}` });
      const next: GeneratedKey = {
        id: created.id,
        label: created.label,
        prefix: created.prefix,
        raw: created.apiKey,
      };
      setGeneratedKey(next);
      setKeys((prev) => [
        {
          id: created.id,
          label: created.label,
          prefix: created.prefix,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        },
        ...prev.filter((k) => k.id !== created.id),
      ]);
      setSelectedKeyId(created.id);
      toast.success("Chave criada — salve agora, ela não é mostrada de novo.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao gerar chave.");
    } finally {
      setCreatingKey(false);
    }
  }, []);

  const selectedExisting = keys.find((k) => k.id === selectedKeyId) ?? null;
  const activeRawKey = generatedKey && generatedKey.id === selectedKeyId ? generatedKey.raw : null;
  const apiKeyDisplay = activeRawKey
    ? activeRawKey
    : selectedExisting
      ? `${selectedExisting.prefix}…`
      : "SUA_API_KEY";

  const commands = useOpenClawCommands({ apiKey: activeRawKey, modelId: currentModelId });
  const usingChatModel = Boolean(currentModelId);
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
        "apiKey": "${activeRawKey ?? "SUA_API_KEY"}",
        "baseUrl": "${commands.apiBaseUrl}",
        "models": [
          {
            "id": "${commands.modelId}",
            "name": "${commands.modelId}"
          }
        ]
      }
    }
  }
}`;

  const noKeys = !loadingKeys && keys.length === 0;

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
          {noKeys ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>Você ainda não tem uma API key</AlertTitle>
              <AlertDescription>
                Gere uma chave abaixo para que o OpenClaw consiga autenticar no ModelHub.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="space-y-3 rounded-lg border bg-card px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Sua API key do ModelHub</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Selecione uma chave existente ou gere uma nova para esta integração.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={creatingKey}
                onClick={() => void handleGenerateKey()}
              >
                {creatingKey ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <PlusIcon className="size-3.5" />
                )}
                Gerar nova chave
              </Button>
            </div>

            <Select
              value={selectedKeyId}
              onValueChange={(value) => {
                setSelectedKeyId(value);
                if (!generatedKey || value !== generatedKey.id) {
                  setGeneratedKey(null);
                }
              }}
              disabled={loadingKeys || keys.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    loadingKeys ? "Carregando chaves…" : keys.length === 0 ? "Nenhuma chave disponível" : "Selecionar chave"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {keys.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    <span className="font-medium">{k.label || "(sem label)"}</span>
                    <span className="ml-2 text-muted-foreground">{k.prefix}…</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {generatedKey && generatedKey.id === selectedKeyId ? (
              <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                <p className="text-xs font-medium text-foreground">
                  Chave criada — salve agora, ela não é exibida novamente.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-[11px]">
                    {generatedKey.raw}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => copy("openclaw-guide-key", generatedKey.raw, "Chave copiada!")}
                  >
                    {copiedId === "openclaw-guide-key" ? (
                      <CheckIcon className="size-3.5 text-emerald-500" />
                    ) : (
                      <CopyIcon className="size-3.5" />
                    )}
                    Copiar chave
                  </Button>
                </div>
              </div>
            ) : selectedExisting ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Os comandos abaixo mantêm <code className="rounded bg-muted px-1 py-0.5 text-[11px]">SUA_API_KEY</code>{" "}
                como placeholder — substitua pela chave{" "}
                <span className="font-medium text-foreground">{selectedExisting.label || "(sem label)"}</span>{" "}
                (prefixo <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{selectedExisting.prefix}…</code>).
                Por segurança, só conseguimos mostrar o valor completo no momento da criação.
              </p>
            ) : null}
          </section>

          {usingChatModel ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <Badge variant="secondary" className="shrink-0">
                Vindo do chat
              </Badge>
              <span className="text-muted-foreground">
                Os comandos abaixo configuram o OpenClaw com{" "}
                <span className="font-medium text-foreground">
                  {currentProviderLabel ?? "o provider atual"}
                </span>
                {currentModelLabel ? (
                  <>
                    {" · "}
                    <span className="font-medium text-foreground">{currentModelLabel}</span>
                  </>
                ) : null}
                .
              </span>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-3">
            <InfoTile icon={<ServerIcon className="size-3.5" />} label="Servidor" value={commands.apiBaseUrl} />
            <InfoTile icon={<KeyRoundIcon className="size-3.5" />} label="API key" value={apiKeyDisplay} />
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
