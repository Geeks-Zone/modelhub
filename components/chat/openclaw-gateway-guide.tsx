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
} from "lucide-react";
import { toast } from "sonner";

import { CommandBlock } from "@/components/openclaw/command-block";
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
  SelectGroup,
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

  const commandApiKey = activeRawKey || "SUA_API_KEY";

  const commands = useOpenClawCommands({ apiKey: commandApiKey, modelId: currentModelId });
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
        "apiKey": "${commandApiKey}",
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,720px)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <TerminalSquareIcon className="size-4 text-muted-foreground" />
            Usar no OpenClaw
          </DialogTitle>
          <DialogDescription>
            Copie o comando abaixo para configurar automaticamente o OpenClaw e usar o ModelHub como gateway OpenAI-compatible. O OpenClaw acessará nosso servidor usando sua API key para listar e rodar modelos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
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
            <ApiKeyTile
              activeRawKey={activeRawKey}
              copiedId={copiedId}
              creatingKey={creatingKey}
              generatedKey={generatedKey}
              keys={keys}
              loadingKeys={loadingKeys}
              selectedKeyId={selectedKeyId}
              selectedKeyPrefix={apiKeyDisplay}
              onCopyGeneratedKey={(raw) => copy("openclaw-guide-key", raw, "Chave copiada!")}
              onGenerateKey={() => void handleGenerateKey()}
              onSelectKey={(value) => {
                setSelectedKeyId(value);
                if (!generatedKey || value !== generatedKey.id) {
                  setGeneratedKey(null);
                }
              }}
            />
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

        <DialogFooter className="m-0 shrink-0 bg-muted/50 px-5 py-3">
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

function ApiKeyTile({
  activeRawKey,
  copiedId,
  creatingKey,
  generatedKey,
  keys,
  loadingKeys,
  selectedKeyId,
  selectedKeyPrefix,
  onCopyGeneratedKey,
  onGenerateKey,
  onSelectKey,
}: {
  readonly activeRawKey: string | null;
  readonly copiedId: string | null;
  readonly creatingKey: boolean;
  readonly generatedKey: GeneratedKey | null;
  readonly keys: ApiKeySummary[];
  readonly loadingKeys: boolean;
  readonly selectedKeyId: string;
  readonly selectedKeyPrefix: string;
  readonly onCopyGeneratedKey: (raw: string) => void;
  readonly onGenerateKey: () => void;
  readonly onSelectKey: (value: string) => void;
}) {
  const hasKeys = keys.length > 0;
  const showingGeneratedKey = Boolean(activeRawKey && generatedKey?.id === selectedKeyId);

  return (
    <div className="min-w-0 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <KeyRoundIcon className="size-3.5" />
          API key
        </p>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          aria-label="Gerar nova API key"
          disabled={creatingKey || loadingKeys}
          onClick={onGenerateKey}
        >
          {creatingKey ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
        </Button>
      </div>

      <Select value={selectedKeyId} onValueChange={onSelectKey} disabled={loadingKeys || !hasKeys}>
        <SelectTrigger size="sm" className="mt-2 w-full min-w-0 bg-background text-xs">
          <SelectValue
            placeholder={loadingKeys ? "Carregando chaves..." : hasKeys ? "Selecionar chave" : "Nenhuma chave"}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {keys.map((key) => (
              <SelectItem key={key.id} value={key.id}>
                <span className="min-w-0 truncate font-medium">{key.label || "(sem label)"}</span>
                <span className="text-muted-foreground">{key.prefix}...</span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {showingGeneratedKey && activeRawKey ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-primary/30 bg-background px-2 py-1.5">
          <code className="min-w-0 flex-1 truncate text-[11px]" title={activeRawKey}>
            {activeRawKey}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Copiar API key"
            onClick={() => onCopyGeneratedKey(activeRawKey)}
          >
            {copiedId === "openclaw-guide-key" ? <CheckIcon /> : <CopyIcon />}
          </Button>
        </div>
      ) : (
        <code className="mt-2 block truncate text-xs text-foreground" title={selectedKeyPrefix}>
          {selectedKeyPrefix}
        </code>
      )}
    </div>
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
