"use client";

import { useActionState, useRef, useState } from "react";
import { processStudentPhotoFile } from "@/lib/student-photo-processing";
import { removeStudentPhoto, updateStudentPhoto } from "./actions";

type Status = "idle" | "processing" | "ready" | "error";

type StudentPhotoManagementProps = {
  studentId: string;
  photoUrl: string | null;
};

const initialState = { error: null as string | null };

export function StudentPhotoManagement({ studentId, photoUrl }: StudentPhotoManagementProps) {
  const [state, formAction, isPending] = useActionState(updateStudentPhoto, initialState);

  const captureInputRef = useRef<HTMLInputElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(photoUrl);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasPendingSelection, setHasPendingSelection] = useState(false);

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setStatus("processing");
    setErrorMessage(null);

    const { file: processedFile, backgroundRemoved } = await processStudentPhotoFile(file);

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(processedFile);

    if (hiddenInputRef.current) {
      hiddenInputRef.current.files = dataTransfer.files;
    }

    setPreviewUrl(URL.createObjectURL(processedFile));
    setHasPendingSelection(true);

    if (backgroundRemoved) {
      setStatus("ready");
    } else {
      setStatus("error");
      setErrorMessage("Arka plan otomatik kaldırılamadı, fotoğraf olduğu gibi eklendi.");
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-lg font-bold">Öğrenci fotoğrafı</h2>

      <p className="mt-1 text-sm text-text-secondary">
        Telefondan çekilen fotoğrafın arka planı otomatik olarak kaldırılır.
      </p>

      {state.error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
        >
          {state.error}
        </div>
      )}

      <form action={formAction} className="mt-5 flex items-center gap-4">
        <input type="hidden" name="studentId" value={studentId} />
        <input ref={hiddenInputRef} type="file" name="studentPhoto" className="hidden" />

        <div
          className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border"
          style={
            previewUrl
              ? {
                  backgroundImage:
                    "linear-gradient(45deg, var(--fill) 25%, transparent 25%), linear-gradient(-45deg, var(--fill) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--fill) 75%), linear-gradient(-45deg, transparent 75%, var(--fill) 75%)",
                  backgroundSize: "12px 12px",
                  backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0px",
                }
              : undefined
          }
        >
          {status === "processing" ? (
            <span className="px-2 text-center text-xs text-text-secondary">İşleniyor...</span>
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Öğrenci fotoğrafı önizleme"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="px-2 text-center text-xs text-text-secondary">Fotoğraf yok</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={status === "processing"}
            onClick={() => captureInputRef.current?.click()}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-primary transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {photoUrl ? "Fotoğrafı değiştir" : "Fotoğraf çek / seç"}
          </button>

          {hasPendingSelection && (
            <button
              type="submit"
              disabled={isPending || status === "processing"}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Kaydediliyor..." : "Fotoğrafı kaydet"}
            </button>
          )}
        </div>

        <input
          ref={captureInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChosen}
          className="hidden"
        />
      </form>

      {errorMessage && <p className="mt-2 text-xs text-accent-strong">{errorMessage}</p>}

      {photoUrl && !hasPendingSelection && (
        <form
          action={removeStudentPhoto}
          className="mt-4"
          onSubmit={(event) => {
            const accepted = window.confirm("Öğrenci fotoğrafı kaldırılsın mı?");

            if (!accepted) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="studentId" value={studentId} />

          <button
            type="submit"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-danger transition hover:bg-surface-muted"
          >
            Fotoğrafı kaldır
          </button>
        </form>
      )}
    </section>
  );
}
