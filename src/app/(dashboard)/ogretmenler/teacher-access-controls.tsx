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
    <div className="mt-5 border-t border-slate-100 pt-4">
      {state.error && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
        >
          {state.error}
        </div>
      )}

      {state.credentials && (
        <div
          role="status"
          className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
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
          <p className="mt-2 leading-5 text-amber-800">
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
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
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
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
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
