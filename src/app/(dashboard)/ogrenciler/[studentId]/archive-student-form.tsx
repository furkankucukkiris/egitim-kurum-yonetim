"use client";

import { useState } from "react";
import { archiveStudent } from "./actions";

export function ArchiveStudentForm({
  studentId,
}: {
  studentId: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
      >
        Öğrenciyi arşivle
      </button>
    );
  }

  return (
    <form
      action={archiveStudent}
      className="rounded-2xl border border-rose-200 bg-rose-50 p-5"
      onSubmit={(event) => {
        const accepted = window.confirm(
          "Öğrenci arşivlenecek ve aktif ders kayıtları kapatılacak. Devam edilsin mi?",
        );

        if (!accepted) {
          event.preventDefault();
        }
      }}
    >
      <input
        type="hidden"
        name="studentId"
        value={studentId}
      />

      <h3 className="font-bold text-rose-800">
        Öğrenciyi arşivle
      </h3>

      <p className="mt-2 text-sm leading-6 text-rose-700">
        Öğrenci silinmeyecek; kayıt geçmişi korunacak ve aktif ders kayıtları kapatılacaktır.
      </p>

      <label className="mt-4 block text-sm font-medium text-rose-900">
        Arşivleme nedeni

        <textarea
          name="exitReason"
          rows={3}
          required
          minLength={3}
          placeholder="Örneğin: Kurumdan ayrıldı"
          className="mt-2 w-full rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm outline-none"
        />
      </label>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700"
        >
          Vazgeç
        </button>

        <button
          type="submit"
          className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Arşivlemeyi onayla
        </button>
      </div>
    </form>
  );
}