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
    <section className="mb-6 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm md:p-6">
      <div className="max-w-2xl">
        <h2 className="text-lg font-bold">
          Yeni öğretmen hesabı
        </h2>

        <p className="mt-1 text-sm leading-6 text-gray-500">
          Öğretmen geçici bilgilerle giriş yapar ve
          ilk girişte kendi parolasını belirler.
        </p>
      </div>

      {state.credentials && (
        <div
          role="status"
          className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
        >
          <p className="font-bold text-emerald-900">
            Öğretmen hesabı oluşturuldu
          </p>

          <p className="mt-1 text-sm leading-6 text-emerald-800">
            Bu geçici bilgileri öğretmene güvenli
            şekilde iletin. Parola bu ekrandan
            ayrıldıktan sonra tekrar gösterilmez.
          </p>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-white/80 p-3">
              <dt className="text-emerald-700">
                E-posta
              </dt>
              <dd className="mt-1 break-all font-mono font-bold text-brand-900">
                {state.credentials.email}
              </dd>
            </div>

            <div className="rounded-xl bg-white/80 p-3">
              <dt className="text-emerald-700">
                Geçici parola
              </dt>
              <dd className="mt-1 break-all font-mono font-bold text-brand-900">
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
            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 md:col-span-3"
          >
            {state.error}
          </div>
        )}

        <label className="block text-sm font-medium">
          Ad soyad
          <span className="ml-1 text-rose-600">
            *
          </span>

          <input
            name="fullName"
            required
            minLength={2}
            autoComplete="name"
            className="mt-2 w-full rounded-xl border border-brand-100 px-4 py-3 text-sm outline-none focus:border-gray-400"
          />
        </label>

        <label className="block text-sm font-medium">
          E-posta
          <span className="ml-1 text-rose-600">
            *
          </span>

          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-2 w-full rounded-xl border border-brand-100 px-4 py-3 text-sm outline-none focus:border-gray-400"
          />
        </label>

        <label className="block text-sm font-medium">
          Telefon

          <input
            name="phone"
            type="tel"
            autoComplete="tel"
            className="mt-2 w-full rounded-xl border border-brand-100 px-4 py-3 text-sm outline-none focus:border-gray-400"
          />
        </label>

        <div className="md:col-span-3 md:text-right">
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-xl bg-terra-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90 disabled:opacity-60 md:w-auto"
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
