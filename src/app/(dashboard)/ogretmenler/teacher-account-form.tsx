"use client";

import { useActionState } from "react";
import {
  createTeacherAccount,
  type TeacherAccountActionState,
} from "./actions";

const initialState: TeacherAccountActionState =
  {
    error: null,
    credentials: null,
  };

export function TeacherAccountForm() {
  const [state, formAction, isPending] =
    useActionState(
      createTeacherAccount,
      initialState,
    );

  return (
    <section className="mb-6 rounded-2xl border border-line bg-panel p-5 shadow-sm md:p-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold">
          Yeni öğretmen hesabı
        </h2>

        <p className="mt-1 text-sm leading-6 text-muted">
          Öğretmen geçici bilgilerle giriş yapar ve
          ilk girişte kendi parolasını belirler.
        </p>
      </div>

      {state.credentials && (
        <div
          role="status"
          className="mt-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 p-4"
        >
          <p className="font-bold text-emerald-900 dark:text-emerald-300">
            Öğretmen hesabı oluşturuldu
          </p>

          <p className="mt-1 text-sm leading-6 text-emerald-800 dark:text-emerald-400">
            Bu geçici bilgileri öğretmene güvenli
            şekilde iletin. Parola bu ekrandan
            ayrıldıktan sonra tekrar gösterilmez.
          </p>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-panel/80 p-3">
              <dt className="text-emerald-700 dark:text-emerald-400">
                E-posta
              </dt>
              <dd className="mt-1 break-all font-mono font-bold text-ink">
                {state.credentials.email}
              </dd>
            </div>

            <div className="rounded-xl bg-panel/80 p-3">
              <dt className="text-emerald-700 dark:text-emerald-400">
                Geçici parola
              </dt>
              <dd className="mt-1 break-all font-mono font-bold text-ink">
                {
                  state.credentials
                    .temporaryPassword
                }
              </dd>
            </div>
          </dl>
        </div>
      )}

      <form
        action={formAction}
        className="mt-5 grid gap-4 md:grid-cols-3"
      >
        {state.error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400 md:col-span-3"
          >
            {state.error}
          </div>
        )}

        <label className="block text-sm font-medium">
          Ad soyad
          <span className="ml-1 text-rose-600 dark:text-rose-400">
            *
          </span>

          <input
            name="fullName"
            required
            minLength={2}
            autoComplete="name"
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-terra-500"
          />
        </label>

        <label className="block text-sm font-medium">
          E-posta
          <span className="ml-1 text-rose-600 dark:text-rose-400">
            *
          </span>

          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-terra-500"
          />
        </label>

        <label className="block text-sm font-medium">
          Telefon

          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-terra-500"
          />
        </label>

        <div className="md:col-span-3 md:text-right">
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90 disabled:opacity-60 md:w-auto"
          >
            {isPending
              ? "Hesap oluşturuluyor..."
              : "Öğretmen hesabı oluştur"}
          </button>
        </div>
      </form>
    </section>
  );
}
