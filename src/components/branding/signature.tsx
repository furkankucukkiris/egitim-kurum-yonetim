import { cn } from "@/lib/utils";

type SignatureProps = {
  variant?: "surface" | "sidebar";
  className?: string;
};

export function Signature({ variant = "surface", className }: SignatureProps) {
  const year = new Date().getFullYear();

  return (
    <p
      className={cn(
        "flex flex-wrap items-baseline justify-center gap-x-1.5 text-center text-[11px]",
        variant === "sidebar" ? "text-sidebar-muted" : "text-text-disabled",
        className,
      )}
    >
      <span
        className={cn(
          "font-display text-sm tracking-[0.25em]",
          variant === "sidebar" ? "text-sidebar-text" : "text-accent-strong",
        )}
      >
        AFK
      </span>
      <span
        className={cn(
          "font-bold",
          variant === "sidebar" ? "text-sidebar-text" : "text-text-secondary",
        )}
      >
        Creative
      </span>
      <span>— All rights reserved © {year}</span>
    </p>
  );
}
