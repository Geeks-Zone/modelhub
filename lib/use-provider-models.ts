"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { ProviderModel, ProviderCredentialSummary, UiProvider } from "@/lib/contracts";
import { apiJson } from "@/lib/api";
import {
  OPENCLAW_PROVIDER_ID,
  type OpenClawMode,
  fetchModelhubCatalogModelsForOpenClaw,
  fetchOpenClawGatewayModelsOrEmpty,
  fetchOpenClawBridgeModels,
  mergeOpenClawModelLists,
  type OpenClawGatewaySettings,
} from "@/lib/openclaw-gateway";

function resolveSelectedModel(
  current: string,
  nextModels: ProviderModel[],
  providerId: string,
): string {
  if (current && nextModels.some((m) => m.id === current)) {
    return current;
  }

  const persisted =
    typeof window !== "undefined"
      ? window.localStorage.getItem(`selected-model:${providerId}`)
      : null;
  if (persisted && nextModels.some((m) => m.id === persisted)) {
    return persisted;
  }

  return nextModels[0]?.id ?? "";
}

type UseProviderModelsInput = {
  credentials: ProviderCredentialSummary[];
  gatewaySettings: OpenClawGatewaySettings;
  bridgeSettings: OpenClawGatewaySettings;
  mode: OpenClawMode;
  providers: UiProvider[];
  selectedProvider: UiProvider | null;
  selectedProviderId: string;
  selectedProviderReady: boolean;
};

type UseProviderModelsReturn = {
  loading: boolean;
  models: ProviderModel[];
  selectedModel: ProviderModel | null;
  selectedModelId: string;
  setSelectedModelId: (id: string) => void;
};

/**
 * Fetches models for the selected provider (OpenClaw or regular).
 * For OpenClaw, routes to gateway or bridge based on the active mode.
 */
export function useProviderModels(input: UseProviderModelsInput): UseProviderModelsReturn {
  const {
    credentials,
    gatewaySettings,
    bridgeSettings,
    mode,
    providers,
    selectedProvider,
    selectedProviderId,
    selectedProviderReady,
  } = input;

  const [models, setModels] = useState<ProviderModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedProviderId || !selectedProvider) return;

    if (!selectedProvider.hasModels) {
      setModels([]);
      setSelectedModelId("");
      return;
    }

    if (!selectedProviderReady) {
      setModels([]);
      setSelectedModelId("");
      return;
    }

    let cancelled = false;
    setLoading(true);

    const handleModels = (nextModels: ProviderModel[], errorLabel: string) => {
      if (cancelled) return;

      if (nextModels.length === 0) {
        toast.error(errorLabel, { duration: 8000 });
      }

      setModels(nextModels);
      setSelectedModelId((current) =>
        resolveSelectedModel(current, nextModels, selectedProvider.id),
      );
    };

    const handleError = (error: unknown, label: string) => {
      if (cancelled) return;
      toast.error(error instanceof Error ? error.message : label);
      setModels([]);
      setSelectedModelId("");
    };

    const handleFinally = () => {
      if (!cancelled) setLoading(false);
    };

    if (selectedProviderId === OPENCLAW_PROVIDER_ID) {
      if (mode === "bridge") {
        fetchOpenClawBridgeModels(bridgeSettings.baseUrl, bridgeSettings.token || undefined)
          .then((m) =>
            handleModels(
              m,
              "Nenhum modelo listado. Inicie a integração local com `npx @model-hub/openclaw-cli run`.",
            ),
          )
          .catch((e) => handleError(e, "Falha ao carregar modelos da integração local."))
          .finally(handleFinally);
      } else {
        Promise.all([
          fetchOpenClawGatewayModelsOrEmpty(gatewaySettings),
          fetchModelhubCatalogModelsForOpenClaw({ credentials, providers }),
        ])
          .then(([gw, catalog]) =>
            handleModels(
              mergeOpenClawModelLists(gw, catalog),
              "Nenhum modelo listado. Inicie o gateway OpenClaw e/ou use o CLI do ModelHub no terminal: npx @model-hub/openclaw-cli setup …",
            ),
          )
          .catch((e) => handleError(e, "Falha ao carregar modelos para OpenClaw."))
          .finally(handleFinally);
      }
    } else {
      apiJson<{ models: ProviderModel[] }>(`${selectedProvider.base}/api/models`)
        .then((payload) => handleModels(payload.models ?? [], "Nenhum modelo disponível."))
        .catch((e) => handleError(e, "Falha ao carregar modelos."))
        .finally(handleFinally);
    }

    return () => {
      cancelled = true;
    };
  }, [
    credentials,
    gatewaySettings,
    bridgeSettings,
    mode,
    providers,
    selectedProvider,
    selectedProviderId,
    selectedProviderReady,
  ]);

  useEffect(() => {
    if (!selectedProvider || !selectedModelId || typeof window === "undefined") return;
    window.localStorage.setItem(`selected-model:${selectedProvider.id}`, selectedModelId);
  }, [selectedModelId, selectedProvider]);

  const selectedModel = models.find((m) => m.id === selectedModelId) ?? null;

  return { loading, models, selectedModel, selectedModelId, setSelectedModelId };
}
