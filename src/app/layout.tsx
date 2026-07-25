import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Eğitim Kurumu Yönetim Sistemi",
  description: "Öğrenci, ödeme, yoklama ve raporlama yönetimi",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
