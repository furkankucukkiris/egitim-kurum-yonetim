"use client";

import { useRef, useState } from "react";
import { resizeImageFile } from "@/lib/image-resize";

type Status = "idle" | "processing" | "ready" | "error";

export function StudentPhotoField() {
  const captureInputRef = useRef<HTMLInputElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setStatus("processing");
    setErrorMessage(null);

    // Telefon kameraları birkaç MB'lık dosyalar üretebiliyor; hem yükleme
    // hem arka plan kaldırma işlemi bundan çok etkileniyor. Önce küçültüyoruz.
    let resized: File;

    try {
      resized = await resizeImageFile(file, 1024, "image/jpeg", 0.85);
    } catch (error) {
      console.error("Fotoğraf küçültülemedi:", error);
      resized = file;
    }

    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const resultBlob = await removeBackground(resized);
      const processedFile = new File(
        [resultBlob],
        "ogrenci-fotografi.png",
        { type: "image/png" },
      );

      setPhotoFile(processedFile);
      setPreviewUrl(URL.createObjectURL(processedFile));
      setStatus("ready");
    } catch (error) {
      console.error("Arka plan kaldırılamadı:", error);

      // Arka plan kaldırma başarısız olursa küçültülmüş orijinal fotoğrafı kullan.
      setPhotoFile(resized);
      setPreviewUrl(URL.createObjectURL(resized));
      setStatus("error");
      setErrorMessage(
        "Arka plan otomatik kaldırılamadı, fotoğraf olduğu gibi eklendi.",
      );
    }
  }

  function setPhotoFile(file: File) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    if (hiddenInputRef.current) {
      hiddenInputRef.current.files = dataTransfer.files;
    }
  }

  function handleRemove() {
    setPreviewUrl(null);
    setStatus("idle");
    setErrorMessage(null);

    if (hiddenInputRef.current) {
      hiddenInputRef.current.value = "";
    }

    if (captureInputRef.current) {
      captureInputRef.current.value = "";
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium">Öğrenci fotoğrafı</label>

      <p className="mt-1 text-xs leading-5 text-muted">
        Telefondan çekilen fotoğrafın arka planı otomatik olarak kaldırılır.
      </p>

      <input
        ref={hiddenInputRef}
        type="file"
        name="studentPhoto"
        className="hidden"
      />

      <div className="mt-3 flex items-center gap-4">
        <div
          className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line"
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
            <span className="px-2 text-center text-xs text-muted">
              İşleniyor...
            </span>
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Öğrenci fotoğrafı önizleme"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="px-2 text-center text-xs text-muted">Fotoğraf yok</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={status === "processing"}
            onClick={() => captureInputRef.current?.click()}
            className="rounded-lg border border-line bg-panel px-3 py-2 text-xs font-semibold text-brand-700 transition hover:bg-fill disabled:cursor-not-allowed disabled:opacity-60 dark:text-brand-100"
          >
            {previewUrl ? "Fotoğrafı değiştir" : "Fotoğraf çek / seç"}
          </button>

          {previewUrl && (
            <button
              type="button"
              onClick={handleRemove}
              className="rounded-lg border border-line bg-panel px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-fill dark:text-rose-400"
            >
              Kaldır
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
      </div>

      {errorMessage && (
        <p className="mt-2 text-xs text-honey-700 dark:text-honey-500">{errorMessage}</p>
      )}
    </div>
  );
}
