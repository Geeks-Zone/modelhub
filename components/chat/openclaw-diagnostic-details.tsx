"use client";

import { CopyIcon } from "lucide-react";

import type { OpenClawGatewayDiagnostic } from "@/lib/openclaw-gateway";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type Props = {
  className?: string;
  diagnostic: OpenClawGatewayDiagnostic;
};

export function OpenClawDiagnosticDetails({ diagnostic, className }: Props) {
  const { copy } = useCopyToClipboard();
  const blocks = diagnostic.codeBlocks ?? [];

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-sm">{diagnostic.summary}</p>
      <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
        {diagnostic.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      {blocks.length > 0 ? (
        <div className="space-y-3 pt-1">
          {blocks.map((block, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium leading-tight text-foreground">{block.title}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={() => copy(`diag-${i}`, block.code, `${block.title} copiado.`)}
                >
                  <CopyIcon className="size-3" />
                  Copiar
                </Button>
              </div>
              <pre className="max-h-48 overflow-auto rounded-md border bg-muted/50 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                {block.code}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
