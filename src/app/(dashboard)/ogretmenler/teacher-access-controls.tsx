"use client";

import { useActionState } from "react";
import {
  resetTeacherPassword,
  setTeacherActive,
  type TeacherPasswordActionState,
} from "./actions";

const initialState: TeacherPasswordActionState =
  {
    error: null,
    credentials: null,
  };

export function TeacherAccessControls({
  teacherId,
  isActive,
}: {
  teacherId: string;
  isActive: boolean;
}) {
  const [state, resetAction, isPending] =
    useActionState(
      resetTeacherPassword,
      initialState,
    );

  return (
    <div className="mt-5 border-t border-brand-50 pt-4">
      {state.error && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-400"
        >
          {state.error}
        </div>
      )}

      {state.credentials && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-honey-100 bg-honey-50 dark:bg-honey-500/10 p-3 text-xs text-honey-700 dark:text-honey-500"
        >
          <p className="font-bold">
            Yeni geçici giriş bilgileri
          </p>
          <p className="mt-2 break-all font-mono">
            {state.credentials.email}
          </p>
          <p className="mt-1 break-all font-mono font-bold">
            {
              state.credentials
                .temporaryPassword
            }
          </p>
          <p className="mt-2 leading-5 text-honey-700 dark:text-honey-500">
            Parola bu sayfadan ayrıldıktan sonra
            tekrar gösterilmez.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={setTeacherActive}>
          <input
            type="hidden"
            name="teacherId"
            value={teacherId}
          />

          <input
            type="hidden"
            name="isActive"
            value={
              isActive ? "false" : "true"
            }
          />

          <button
            type="submit"
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
              isActive
                ? "border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400"
                : "border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {isActive
              ? "Hesabı pasife al"
              : "Hesabı aktifleştir"}
          </button>
        </form>

        <form action={resetAction}>
          <input
            type="hidden"
            name="teacherId"
            value={teacherId}
          />

          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg border border-line bg-panel px-3 py-2 text-xs font-semibold text-brand-700 disabled:opacity-60"
          >
            {isPending
              ? "Yenileniyor..."
              : "Geçici parolayı yenile"}
          </button>
        </form>
      </div>
    </div>
  );
}
