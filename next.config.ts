import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Yalnızca production build'de uygulanır — Next.js dev sunucusunun
// HMR/Fast Refresh script enjeksiyonu geliştirmede CSP ile çakışabilir.
// script-src'de 'unsafe-inline' hâlâ var çünkü Next.js App Router'ın
// nonce'suz hydration bootstrap script'i buna ihtiyaç duyuyor; daha
// sıkı bir CSP için middleware üzerinden nonce enjeksiyonu gerekir —
// bu, "uygulamayı bozmadan ekle" önceliğiyle sonraki bir adım olarak
// bırakıldı (bkz. docs/guvenlik-kontrol-listesi.md).
//
// script-src'deki 'blob:' ve connect-src'deki staticimgly.com,
// öğrenci fotoğrafı arka plan kaldırma özelliği (@imgly/background-removal)
// için gerekli: kütüphane ONNX modelini/wasm dosyalarını bu CDN'den
// fetch ile indirip blob: URL üzerinden bir ES module olarak import
// ediyor. Bu izin olmadan fetch CSP tarafından sessizce engelleniyor
// ve kütüphane hiçbir zaman arka planı kaldırmadan orijinal fotoğrafa
// geri dönüyordu. Fotoğrafın kendisi tarayıcıdan hiçbir zaman bu CDN'e
// gönderilmiyor — yalnızca genel/anonim model dosyaları indiriliyor.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' https://staticimgly.com ${supabaseUrl}`.trim(),
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // Varsayılan 1MB sınırı, kurum logosu ve öğrenci fotoğrafı gibi
      // dosya yüklemeli Server Action formlarını "Failed to fetch"
      // hatasıyla sessizce başarısız kılıyordu.
      bodySizeLimit: "10mb",
    },
  },

  async headers() {
    const headers =
      process.env.NODE_ENV === "production"
        ? [...securityHeaders, { key: "Content-Security-Policy", value: csp }]
        : securityHeaders;

    return [
      {
        source: "/:path*",
        headers,
      },
    ];
  },
};

export default nextConfig;
