"use client";

import { useActionState } from "react";
import {
  changeRequiredPassword,
  type PasswordActionState,
} from "./actions";

const initialState: PasswordActionState = {
  error: null,
};

export function PasswordForm() {
  const [state, formAction, isPending] =
    useActionState(
      changeRequiredPassword,
      initialState,
    );

  return (
    <form
      action={formAction}
      className="mt-6 space-y-4"
    >
      {state.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400"
        >
          {state.error}
        </div>
      )}

      <label className="block text-sm font-medium">
        Yeni parola

        <input
          name="password"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-terra-500"
        />
      </label>

      <label className="block text-sm font-medium">
        Yeni parola tekrar

        <input
          name="passwordConfirmation"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="mt-2 w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-terra-500"
        />
      </label>

      <p className="text-xs leading-5 text-muted">
        En az 12 karakter; bir büyük harf,
        bir küçük harf ve bir rakam kullanın.
      </p>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 font-semibold text-white transition hover:bg-terra-700/90 disabled:opacity-60"
      >
        {isPending
          ? "Kaydediliyor..."
          : "Parolamı belirle"}
      </button>
    </form>
  );
}
