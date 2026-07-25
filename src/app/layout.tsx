import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eğitim Kurumu Yönetim Sistemi",
  description: "Öğrenci, ödeme, yoklama ve raporlama yönetimi",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}