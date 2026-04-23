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

type UseOpenClawConnectionReturn = {
  /** Active mode: bridge is the primary default; gateway is advanced/manual. */
  mode: OpenClawMode;
  /** Whether the bridge probe passed. */
  bridgeUsable: boolean;
  /** Current bridge settings (baseUrl + token). */
  bridgeSettings: OpenClawGatewaySettings;
  /** Current bridge probe state. */
  bridgeProbe: OpenClawBridgeProbeState;
  /** Whether the gateway has token AND probe passed. */
  gatewayUsable: boolean;
  /** Current gateway settings (baseUrl + token). */
  gatewaySettings: OpenClawGatewaySettings;
  /** Current gateway probe state. */
  gatewayProbe: OpenClawProbeState;
  /** Whether the active OpenClaw connection is usable (mode-selected). */
  isOpenClawReady: boolean;
  /** Check if OpenClaw provider is configured/configured (any mode probe ok). */
  isOpenClawConfigured: boolean;
  /** Called by the setup dialog on gateway saved. */
  onGatewaySaved: (settings: OpenClawGatewaySettings) => void;
  /** Called by the setup dialog on bridge saved. */
  onBridgeSaved: (settings: OpenClawGatewaySettings, probeOk: boolean) => void;
  /** Manually retry the active probe. */
  retryProbe: () => void;
  /** Change mode (bridge/gateway). */
  setMode: (mode: OpenClawMode) => void;
  /** Open the setup for the given mode. */
  setupOpen: boolean;
  setSetupOpen: (open: boolean) => void;
};

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

  const [mode, setMode] = useState<OpenClawMode>("bridge");
  const [setupOpen, setSetupOpen] = useState(false);

  const bridgeProbeSkipRef = useRef(false);
  const autoDetectedRef = useRef(false);

  // --- Init: load settings from localStorage on mount ---
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

  // --- Auto-detect: keep bridge as the primary default on first load ---
  useEffect(() => {
    if (autoDetectedRef.current) return;
    if (selectedProviderId !== OPENCLAW_PROVIDER_ID) return;

    const savedMode = typeof window !== "undefined"
      ? window.localStorage.getItem("openclaw-mode") as OpenClawMode | null
      : null;
    if (savedMode === "gateway" || savedMode === "bridge") {
      setMode(savedMode);
      autoDetectedRef.current = true;
      return;
    }

    // No saved mode — auto-detect by probing bridge first
    const bridgeBase = loadOpenClawBridgeSettings().baseUrl || OPENCLAW_DEFAULT_BRIDGE;
    let cancelled = false;
    probeOpenClawBridge(normalizeGatewayBaseUrl(bridgeBase)).then((result) => {
      if (cancelled) return;
      if (result && result.bridge.status === "ok") {
        setMode("bridge");
      } else {
        setMode("bridge");
      }
      autoDetectedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [selectedProviderId]);

  // --- Persist mode to localStorage ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (mode) {
      window.localStorage.setItem("openclaw-mode", mode);
    }
  }, [mode]);

  // --- Auto-probe gateway when settings change ---
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
    const tid = window.setTimeout(() => {
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
      window.clearTimeout(tid);
    };
  }, [gatewaySettings, gatewaySettingsVersion, selectedProviderId]);

  // --- Auto-probe bridge when settings change ---
  useEffect(() => {
    if (selectedProviderId !== OPENCLAW_PROVIDER_ID) return;
    if (!bridgeSettings.baseUrl.trim()) return;

    if (bridgeProbeSkipRef.current) {
      bridgeProbeSkipRef.current = false;
      return;
    }

    let cancelled = false;
    setBridgeProbe({ status: "loading" });
    const tid = window.setTimeout(() => {
      probeOpenClawBridge(bridgeSettings.baseUrl).then((result) => {
        if (cancelled) return;
        if (result && result.bridge.status === "ok") {
          setBridgeProbe({ status: "ok" });
        } else {
          setBridgeProbe({ status: "error" });
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(tid);
    };
  }, [selectedProviderId, bridgeSettings]);

  // --- Computed flags ---
  const gatewayUsable = hasOpenClawGatewayToken(gatewaySettings) && gatewayProbe.status === "ok";
  const bridgeUsable = bridgeProbe.status === "ok";
  const isOpenClawReady = mode === "bridge" ? bridgeUsable : gatewayUsable;
  const isOpenClawConfigured = mode === "bridge" ? bridgeProbe.status === "ok" : gatewayProbe.status === "ok";

  // --- Callbacks ---
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
        if (result && result.bridge.status === "ok") {
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
