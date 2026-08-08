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
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
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
          className="mt-2 w-full rounded-xl border border-brand-100 px-4 py-3 outline-none focus:border-gray-400"
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
          className="mt-2 w-full rounded-xl border border-brand-100 px-4 py-3 outline-none focus:border-gray-400"
        />
      </label>

      <p className="text-xs leading-5 text-gray-500">
        En az 12 karakter; bir büyük harf,
        bir küçük harf ve bir rakam kullanın.
      </p>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-terra-700 px-4 py-3 font-semibold text-white transition hover:bg-terra-700/90 disabled:opacity-60"
      >
        {isPending
          ? "Kaydediliyor..."
          : "Parolamı belirle"}
      </button>
    </form>
  );
}
