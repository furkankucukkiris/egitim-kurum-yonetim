import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Yalnızca production build'de uygulanır — Next.js dev sunucusunun
// HMR/Fast Refresh script enjeksiyonu geliştirmede CSP ile çakışabilir.
// script-src'de 'unsafe-inline' hâlâ var çünkü Next.js App Router'ın
// nonce'suz hydration bootstrap script'i buna ihtiyaç duyuyor; daha
// sıkı bir CSP için middleware üzerinden nonce enjeksiyonu gerekir —
// bu, "uygulamayı bozmadan ekle" önceliğiyle sonraki bir adım olarak
// bırakıldı (bkz. docs/guvenlik-kontrol-listesi.md).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${supabaseUrl}`.trim(),
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
