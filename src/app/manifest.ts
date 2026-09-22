import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Efsu Yönetim",
    short_name: "Efsu Yönetim",
    description: "Öğrenci, ödeme, yoklama ve raporlama yönetimi",
    start_url: "/",
    display: "standalone",
    background_color: "#F4F7FA",
    theme_color: "#183B5B",
    icons: [
      {
        src: "/icon.png",
        sizes: "64x64",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
