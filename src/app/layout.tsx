import type { Metadata } from "next";
import { Inter, Orbitron } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Eğitim Kurumu Yönetim Sistemi",
  description: "Öğrenci, ödeme, yoklama ve raporlama yönetimi",
};

const themeInitScript = `
(function () {
 try {
 var stored = localStorage.getItem("theme");
 var isDark =
 stored === "dark" ||
 (stored !== "light" &&
 window.matchMedia("(prefers-color-scheme: dark)").matches);
 document.documentElement.classList.toggle("dark", isDark);
 } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="tr"
      className={`${inter.variable} ${orbitron.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
