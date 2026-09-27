import { resizeImageFile } from "@/lib/image-resize";

export type ProcessedStudentPhoto = {
  file: File;
  backgroundRemoved: boolean;
};

/**
 * Telefon kameraları birkaç MB'lık dosyalar üretebiliyor; hem yükleme hem
 * arka plan kaldırma işlemi bundan çok etkileniyor. Önce küçültüyoruz,
 * sonra arka planı kaldırıyoruz. Arka plan kaldırma başarısız olursa
 * küçültülmüş orijinal fotoğraf kullanılır.
 */
export async function processStudentPhotoFile(file: File): Promise<ProcessedStudentPhoto> {
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
    const processedFile = new File([resultBlob], "ogrenci-fotografi.png", { type: "image/png" });

    return { file: processedFile, backgroundRemoved: true };
  } catch (error) {
    console.error("Arka plan kaldırılamadı:", error);

    return { file: resized, backgroundRemoved: false };
  }
}
