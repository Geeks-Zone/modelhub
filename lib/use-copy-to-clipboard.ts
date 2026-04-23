"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

export function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = useCallback((id: string, text: string, successMsg?: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopiedId(id);
        toast.success(successMsg ?? "Copiado.");
        setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
      },
      () => {
        toast.error("Não foi possível copiar.");
      },
    );
  }, []);

  return { copiedId, copy };
}