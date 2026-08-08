"use client";

import { useRef, useState } from "react";
import { resizeImageFile } from "@/lib/image-resize";

export function LogoField({ currentLogoUrl }: { currentLogoUrl: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl);
  const [processing, setProcessing] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setPreviewUrl(currentLogoUrl);
      return;
    }

    // Büyük bir fotoğraf (ör. logonun telefonla çekilmiş hali) yükleme
    // isteğini başarısız kılabiliyor; SVG hariç her şeyi küçültüyoruz.
    if (file.type === "image/svg+xml") {
      setPreviewUrl(URL.createObjectURL(file));
      return;
    }

    setProcessing(true);

    try {
      const resized = await resizeImageFile(file, 512, "image/png");
      setInputFile(resized);
      setPreviewUrl(URL.createObjectURL(resized));
    } catch (error) {
      console.error("Logo küçültülemedi:", error);
      setPreviewUrl(URL.createObjectURL(file));
    } finally {
      setProcessing(false);
    }
  }

  function setInputFile(file: File) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    if (inputRef.current) {
      inputRef.current.files = dataTransfer.files;
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-fill">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Kurum logosu" className="h-full w-full object-cover" />
        ) : (
          <span className="text-xs text-muted">Logo yok</span>
        )}
      </div>

      <label className="block flex-1 text-sm font-medium">
        Logo

        <input
          ref={inputRef}
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={handleChange}
          className="mt-2 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-fill file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 dark:file:text-brand-100"
        />

        <span className="mt-2 block text-xs leading-5 text-muted">
          {processing
            ? "Görsel küçültülüyor..."
            : "PNG, JPEG, WEBP veya SVG. Boş bırakırsan mevcut logo korunur."}
        </span>
      </label>
    </div>
  );
}
