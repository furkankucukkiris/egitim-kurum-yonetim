import { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ className = "", elevated = false, ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-border p-4 transition-[border-color,background-color] duration-200 ${
        elevated ? "bg-surface-elevated shadow-elevated" : "bg-surface"
      } ${className}`}
      {...props}
    />
  );
}
