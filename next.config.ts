import type { NextConfig } from "next";

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
};

export default nextConfig;
