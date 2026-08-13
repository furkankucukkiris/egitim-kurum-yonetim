"use client";

import { useState } from "react";
import { archiveStudent } from "./actions";

export function ArchiveStudentForm({ studentId }: { studentId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl border border-danger/30 bg-surface px-4 py-3 text-sm font-semibold text-danger hover:bg-danger-soft"
      >
        Öğrenciyi arşivle
      </button>
    );
  }

  return (
    <form
      action={archiveStudent}
      className="rounded-2xl border border-danger/30 bg-danger-soft p-5"
      onSubmit={(event) => {
        const accepted = window.confirm(
          "Öğrenci arşivlenecek ve aktif ders kayıtları kapatılacak. Devam edilsin mi?",
        );

        if (!accepted) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="studentId" value={studentId} />

      <h3 className="font-bold text-danger text-danger">Öğrenciyi arşivle</h3>

      <p className="mt-2 text-sm leading-6 text-danger">
        Öğrenci silinmeyecek; kayıt geçmişi korunacak ve aktif ders kayıtları kapatılacaktır.
      </p>

      <label className="mt-4 block text-sm font-medium text-danger text-danger">
        Arşivleme nedeni
        <textarea
          name="exitReason"
          rows={3}
          required
          minLength={3}
          placeholder="Örneğin: Kurumdan ayrıldı"
          className="mt-2 w-full rounded-xl border border-danger/30 bg-surface px-4 py-3 text-sm outline-none"
        />
      </label>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl border border-danger/30 bg-surface px-4 py-2 text-sm font-semibold text-danger"
        >
          Vazgeç
        </button>

        <button
          type="submit"
          className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-on-primary"
        >
          Arşivlemeyi onayla
        </button>
      </div>
    </form>
  );
}
