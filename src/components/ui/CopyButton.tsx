"use client";

import { useState } from "react";

// Küçük "Kopyala" düğmesi; tıklanınca değeri panoya alır ve kısa süre
// "Kopyalandı" gösterir.
export function CopyButton({ value, label = "Kopyala" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${label}: ${value}`}
      className="rounded-md border border-border px-2 py-0.5 text-xs font-semibold text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {copied ? "Kopyalandı" : label}
    </button>
  );
}
