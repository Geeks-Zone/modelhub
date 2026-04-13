"use client";

import { useSyncExternalStore } from "react";
import { MonitorCogIcon, MoonStarIcon, SunMediumIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

function getLabel(next: string) {
  if (next === "dark") return "Ativar tema escuro";
  if (next === "light") return "Ativar tema claro";
  return "Usar tema do sistema";
}

const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function ModeToggle() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, getClientSnapshot, getServerSnapshot);

  function getNextTheme() {
    if (theme === "system") return "light";
    if (theme === "light") return "dark";
    return "system";
  }

  function getIcon() {
    if (!mounted) return <SunMediumIcon data-icon="inline-start" />;
    if (resolvedTheme === "dark") return <MoonStarIcon data-icon="inline-start" />;
    if (theme === "system") return <MonitorCogIcon data-icon="inline-start" />;
    return <SunMediumIcon data-icon="inline-start" />;
  }

  const nextTheme = getNextTheme();
  const label = getLabel(nextTheme);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setTheme(nextTheme)}
      aria-label={label}
      title={label}
      suppressHydrationWarning
    >
      {getIcon()}
      Tema
    </Button>
  );
}
