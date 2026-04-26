"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  OPENCLAW_DEFAULT_BASE,
  OPENCLAW_DEFAULT_BRIDGE,
  OPENCLAW_PROVIDER_ID,
  type OpenClawMode,
  hasOpenClawGatewayToken,
  loadOpenClawGatewaySettings,
  loadOpenClawBridgeSettings,
  normalizeGatewayBaseUrl,
  probeOpenClawGateway,
  probeOpenClawBridge,
  type OpenClawGatewayDiagnostic,
  type OpenClawGatewaySettings,
} from "@/lib/openclaw-gateway";

type OpenClawProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok" }
  | { status: "error"; diagnostic: OpenClawGatewayDiagnostic };

type OpenClawBridgeProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok" }
  | { status: "error" };

type OpenClawDegradedProvider = {
  credentialKey: string;
  providerId: string;
  reason: string;
};

type UseOpenClawConnectionReturn = {
  readonly bridgeProbe: OpenClawBridgeProbeState;
  readonly bridgeSettings: OpenClawGatewaySettings;
  readonly bridgeUsable: boolean;
  readonly degradedProviders: OpenClawDegradedProvider[];
  readonly gatewayProbe: OpenClawProbeState;
  readonly gatewaySettings: OpenClawGatewaySettings;
  readonly gatewayUsable: boolean;
  readonly isOpenClawConfigured: boolean;
  readonly isOpenClawReady: boolean;
  readonly mode: OpenClawMode;
  readonly onBridgeSaved: (settings: OpenClawGatewaySettings, probeOk: boolean) => void;
  readonly onGatewaySaved: (settings: OpenClawGatewaySettings) => void;
  readonly retryProbe: () => void;
  readonly setMode: (mode: OpenClawMode) => void;
  readonly setSetupOpen: (open: boolean) => void;
  readonly setupOpen: boolean;
};

function loadPersistedMode(): OpenClawMode | null {
  if (typeof globalThis.window === "undefined") return null;
  const stored = globalThis.localStorage.getItem("openclaw-mode");
  if (stored === "gateway" || stored === "bridge") return stored;
  return null;
}

function persistMode(mode: OpenClawMode) {
  if (typeof globalThis.window === "undefined") return;
  globalThis.localStorage.setItem("openclaw-mode", mode);
}

function recordOpenClawUsage(mode: OpenClawMode, action: string) {
  if (typeof globalThis.window === "undefined") return;
  void fetch("/api/openclaw/usage", {
    body: JSON.stringify({ action, mode }),
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => {
    // Usage logs must never affect the chat flow.
  });
}

/**
 * Encapsulates all OpenClaw connection state.
 * Probes bridge/gateway state on mount while keeping bridge as the primary default.
 * Exposes the active mode so consumers route requests correctly.
 */
export function useOpenClawConnection(selectedProviderId: string): UseOpenClawConnectionReturn {
  const [gatewaySettings, setGatewaySettings] = useState<OpenClawGatewaySettings>({
    baseUrl: OPENCLAW_DEFAULT_BASE,
    token: "",
  });
  const [gatewaySettingsVersion, setGatewaySettingsVersion] = useState(0);
  const [gatewayProbe, setGatewayProbe] = useState<OpenClawProbeState>({ status: "idle" });

  const [bridgeSettings, setBridgeSettings] = useState<OpenClawGatewaySettings>({
    baseUrl: OPENCLAW_DEFAULT_BRIDGE,
    token: "",
  });
  const [bridgeProbe, setBridgeProbe] = useState<OpenClawBridgeProbeState>({ status: "idle" });

  const [degradedProviders, setDegradedProviders] = useState<OpenClawDegradedProvider[]>([]);
  const [mode, setMode] = useState<OpenClawMode>("bridge");
  const [setupOpen, setSetupOpen] = useState(false);

  const bridgeProbeSkipRef = useRef(false);
  const autoDetectedRef = useRef(false);
  const loggedModeRef = useRef<OpenClawMode | null>(null);

  useEffect(() => {
    const settings = loadOpenClawGatewaySettings();
    setGatewaySettings(settings);
    if (hasOpenClawGatewayToken(settings)) {
      setGatewaySettingsVersion((v) => v + 1);
    }
  }, []);

  useEffect(() => {
    setBridgeSettings(loadOpenClawBridgeSettings());
  }, []);

  // Bridge e o modo padrao; o usuario opta por gateway via dialogo.
  // Antes ha um probe assincrono cujos dois ramos chamavam setMode("bridge"),
  // tornando o probe inutil — removido.
  useEffect(() => {
    if (autoDetectedRef.current) return;
    if (selectedProviderId !== OPENCLAW_PROVIDER_ID) return;

    const savedMode = loadPersistedMode();
    setMode(savedMode ?? "bridge");
    autoDetectedRef.current = true;
  }, [selectedProviderId]);

  useEffect(() => {
    persistMode(mode);
    if (selectedProviderId !== OPENCLAW_PROVIDER_ID) return;
    if (loggedModeRef.current === mode) return;
    loggedModeRef.current = mode;
    recordOpenClawUsage(mode, "mode.active");
  }, [mode, selectedProviderId]);

  useEffect(() => {
    if (selectedProviderId !== OPENCLAW_PROVIDER_ID) {
      setDegradedProviders([]);
      return;
    }

    const controller = new AbortController();
    void fetch("/openclaw/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        setDegradedProviders(Array.isArray(payload?.degradedProviders) ? payload.degradedProviders : []);
      })
      .catch(() => {
        // Status degradation is advisory; ignore network/auth failures here.
      });

    return () => controller.abort();
  }, [selectedProviderId]);

  useEffect(() => {
    const token = gatewaySettings.token.trim();
    if (!token) {
      setGatewayProbe({ status: "idle" });
      return;
    }

    const shouldProbe =
      selectedProviderId === OPENCLAW_PROVIDER_ID || gatewaySettingsVersion > 0;
    if (!shouldProbe) return;

    let cancelled = false;
    setGatewayProbe({ status: "loading" });
    const tid = globalThis.setTimeout(() => {
      probeOpenClawGateway(gatewaySettings).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setGatewayProbe({ status: "ok" });
        } else {
          setGatewayProbe({ status: "error", diagnostic: result.diagnostic });
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      globalThis.clearTimeout(tid);
    };
  }, [gatewaySettings, gatewaySettingsVersion, selectedProviderId]);

  useEffect(() => {
    if (selectedProviderId !== OPENCLAW_PROVIDER_ID) return;
    if (!bridgeSettings.baseUrl.trim()) return;

    if (bridgeProbeSkipRef.current) {
      bridgeProbeSkipRef.current = false;
      return;
    }

    let cancelled = false;
    setBridgeProbe({ status: "loading" });
    const tid = globalThis.setTimeout(() => {
      probeOpenClawBridge(bridgeSettings.baseUrl).then((result) => {
        if (cancelled) return;
        if (result?.bridge.status === "ok") {
          setBridgeProbe({ status: "ok" });
        } else {
          setBridgeProbe({ status: "error" });
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      globalThis.clearTimeout(tid);
    };
  }, [selectedProviderId, bridgeSettings]);

  const gatewayUsable = hasOpenClawGatewayToken(gatewaySettings) && gatewayProbe.status === "ok";
  const bridgeUsable = bridgeProbe.status === "ok";
  const isOpenClawReady = mode === "bridge" ? bridgeUsable : gatewayUsable;
  const isOpenClawConfigured = mode === "bridge" ? bridgeProbe.status === "ok" : gatewayProbe.status === "ok";

  const onGatewaySaved = useCallback((settings: OpenClawGatewaySettings) => {
    setGatewaySettings(settings);
    setGatewaySettingsVersion((v) => v + 1);
  }, []);

  const onBridgeSaved = useCallback((settings: OpenClawGatewaySettings, probeOk: boolean) => {
    bridgeProbeSkipRef.current = true;
    setBridgeSettings(settings);
    setBridgeProbe(probeOk ? { status: "ok" } : { status: "error" });
  }, []);

  const retryProbe = useCallback(() => {
    if (mode === "bridge") {
      const base = normalizeGatewayBaseUrl(bridgeSettings.baseUrl);
      setBridgeProbe({ status: "loading" });
      void probeOpenClawBridge(base).then((result) => {
        if (result?.bridge.status === "ok") {
          setBridgeProbe({ status: "ok" });
          toast.success("OpenClaw local conectado.");
        } else {
          setBridgeProbe({ status: "error" });
          toast.error("Não foi possível confirmar a integração local do OpenClaw.");
        }
      });
    } else {
      if (!hasOpenClawGatewayToken(gatewaySettings)) return;
      setGatewayProbe({ status: "loading" });
      void probeOpenClawGateway(gatewaySettings).then((result) => {
        if (result.ok) {
          setGatewayProbe({ status: "ok" });
          toast.success("Gateway OpenClaw respondeu.");
        } else {
          setGatewayProbe({ status: "error", diagnostic: result.diagnostic });
          toast.error("Ainda não foi possível confirmar o gateway.");
        }
      });
    }
  }, [mode, bridgeSettings, gatewaySettings]);

  return {
    bridgeProbe,
    bridgeSettings,
    bridgeUsable,
    degradedProviders,
    gatewayProbe,
    gatewaySettings,
    gatewayUsable,
    isOpenClawConfigured,
    isOpenClawReady,
    mode,
    onBridgeSaved,
    onGatewaySaved,
    retryProbe,
    setMode,
    setupOpen,
    setSetupOpen,
  };
}
