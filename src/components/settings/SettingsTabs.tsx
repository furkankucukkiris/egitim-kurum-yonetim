"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/kurum-ayarlari/gorunum", label: "Görünüm" },
  { href: "/kurum-ayarlari/genel", label: "Genel" },
  { href: "/kurum-ayarlari/iletisim", label: "İletişim Bilgileri" },
  { href: "/kurum-ayarlari/whatsapp", label: "WhatsApp Botu" },
  { href: "/kurum-ayarlari/otomasyon", label: "Otomasyon" },
  { href: "/kurum-ayarlari/kasa-banka", label: "Kasa & Banka" },
  { href: "/kurum-ayarlari/kullanicilar", label: "Kullanıcı Hesapları" },
  { href: "/kurum-ayarlari/denetim-kayitlari", label: "Denetim Kaydı" },
];

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(`${tab.href}/`);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
              active
                ? "border-terra-700 text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
