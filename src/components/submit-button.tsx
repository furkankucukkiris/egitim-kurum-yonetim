"use client";

import { useFormStatus } from "react-dom";

type SubmitButtonProps = {
  children: React.ReactNode;
  pendingText?: string;
};

export function SubmitButton({
  children,
  pendingText = "Kaydediliyor...",
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-terra-700 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}