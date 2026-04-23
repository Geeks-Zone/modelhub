"use client";

import { CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type CommandBlockProps = {
  command: string;
  copyId: string;
  label?: string;
  successMessage?: string;
};

export function CommandBlock({ command, copyId, label, successMessage }: CommandBlockProps) {
  const { copiedId, copy } = useCopyToClipboard();

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-xl bg-muted px-4 py-3 text-xs leading-relaxed">
        <code>{command}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => copy(copyId, command, successMessage)}
      >
        {copiedId === copyId ? <CheckIcon className="size-3.5 text-green-500" /> : <CopyIcon className="size-3.5" />}
      </Button>
      {label ? (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full gap-2 text-xs"
          onClick={() => copy(`${copyId}-btn`, command, successMessage)}
        >
          {copiedId === `${copyId}-btn` ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copiedId === `${copyId}-btn` ? "Copiado" : label}
        </Button>
      ) : null}
    </div>
  );
}