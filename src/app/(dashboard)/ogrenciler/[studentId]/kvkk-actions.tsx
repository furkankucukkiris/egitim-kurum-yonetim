"use client";

import { useState } from "react";
import { anonymizeStudent } from "./actions";

type KvkkActionsProps = {
  studentId: string;
  fullName: string;
  isArchived: boolean;
  isAlreadyAnonymized: boolean;
};

export function KvkkActions({
  studentId,
  fullName,
  isArchived,
  isAlreadyAnonymized,
}: KvkkActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [reason, setReason] = useState("");

  const nameMatches = confirmationName === fullName;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-bold">KVKK işlemleri</h2>

      <p className="mt-1 text-sm text-text-secondary">
        Veri sahibi (öğrenci/veli) talebiyle ilgili işlemler.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={`/ogrenciler/${studentId}/kvkk-export`}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary transition hover:bg-surface-muted text-primary"
        >
          Kişisel verileri dışa aktar (JSON)
        </a>

        {!isAlreadyAnonymized && !confirmOpen && (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!isArchived}
            className="rounded-xl border border-danger/30 bg-surface px-4 py-3 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-50"
            title={isArchived ? undefined : "Anonimleştirmeden önce öğrenci arşivlenmelidir."}
          >
            Anonimleştir
          </button>
        )}
      </div>

      {!isArchived && !isAlreadyAnonymized && (
        <p className="mt-3 text-xs text-text-secondary">
          Anonimleştirmeden önce öğrenciyi arşivlemeniz gerekir.
        </p>
      )}

      {isAlreadyAnonymized && (
        <p className="mt-3 text-xs text-text-secondary">
          Bu öğrenci kaydı zaten anonimleştirilmiş.
        </p>
      )}

      {confirmOpen && (
        <form
          action={anonymizeStudent}
          className="mt-5 rounded-2xl border border-danger/30 bg-danger-soft p-5"
        >
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="expectedName" value={fullName} />

          <h3 className="font-bold text-danger text-danger">Anonimleştirmeyi onayla</h3>

          <p className="mt-2 text-sm leading-6 text-danger">
            Bu işlem geri alınamaz. Öğrencinin ve (başka öğrencisi olmayan) velisinin adı, T.C.
            kimlik no, doğum tarihi, adres, acil durum bilgisi, sağlık notu ve fotoğrafı kalıcı
            olarak silinir. Ödeme ve devam kayıtları muhasebe bütünlüğü için saklanır, ancak artık
            kimliklendirilemez bir kayda bağlı olur.
          </p>

          <label className="mt-4 block text-sm font-medium text-danger text-danger">
            Anonimleştirme nedeni
            <textarea
              name="reason"
              rows={2}
              required
              minLength={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Örneğin: Veli KVKK madde 11 kapsamında silme talebinde bulundu."
              className="mt-2 w-full rounded-xl border border-danger/30 bg-surface px-4 py-3 text-sm outline-none"
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-danger text-danger">
            Onaylamak için öğrencinin tam adını yazın: <strong>{fullName}</strong>
            <input
              name="confirmationName"
              required
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              className="mt-2 w-full rounded-xl border border-danger/30 bg-surface px-4 py-3 text-sm outline-none"
            />
          </label>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="rounded-xl border border-danger/30 bg-surface px-4 py-2 text-sm font-semibold text-danger"
            >
              Vazgeç
            </button>

            <button
              type="submit"
              disabled={!nameMatches || reason.trim().length < 3}
              className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Kalıcı olarak anonimleştir
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
