import {
  ActivityIcon,
  SparklesIcon,
} from "lucide-react";

import { AuthButtons } from "@/components/landing/auth-buttons";
import { Badge } from "@/components/ui/badge";

export function HeroSection() {
  return (
    <section className="relative flex flex-col items-center gap-8 px-6 pt-24 pb-16 text-center md:pt-32 md:pb-24">
      <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-xs">
        <SparklesIcon className="size-3" />
        Hub de modelos de IA
      </Badge>

      <div className="flex max-w-3xl flex-col items-center gap-5">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          Todos os seus modelos de{" "}
          <span className="bg-gradient-to-r from-primary to-chart-1 bg-clip-text text-transparent">
            IA em um só lugar
          </span>
        </h1>
        <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Conecte, gerencie e converse com múltiplos modelos de inteligência artificial
          através de uma interface unificada. API compatível com OpenAI, dashboard
          completo e controle total das suas credenciais.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <AuthButtons size="lg" />
      </div>

      <div className="mt-8 flex items-center gap-6 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <ActivityIcon className="size-4 text-primary" />
          <span>Multi-provider</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <span>API OpenAI-compatível</span>
        <div className="h-4 w-px bg-border" />
        <span>100% gratuito</span>
      </div>
    </section>
  );
}

