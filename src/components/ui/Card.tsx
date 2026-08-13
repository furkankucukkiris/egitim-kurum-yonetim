import { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ className = "", elevated = false, ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-border p-4 ${
        elevated ? "bg-surface-elevated shadow-elevated" : "bg-surface shadow-sm"
      } ${className}`}
      {...props}
    />
  );
}
