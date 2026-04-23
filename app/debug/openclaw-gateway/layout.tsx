import type { Metadata } from "next";

export const metadata: Metadata = {
  description: "Página de diagnóstico para testar a ligação ao gateway OpenClaw local.",
  robots: { index: false, follow: false },
  title: "Debug · Gateway OpenClaw · ModelHub",
};

export default function DebugOpenclawGatewayLayout({ children }: { children: React.ReactNode }) {
  return children;
}