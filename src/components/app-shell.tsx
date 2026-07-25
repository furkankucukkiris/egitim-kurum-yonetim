"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Genel Bakış", icon: "⌂" },
  { href: "/ogrenciler", label: "Öğrenciler", icon: "◎" },
  { href: "/odemeler", label: "Ödemeler", icon: "₺" },
  { href: "/yoklama", label: "Yoklama", icon: "✓" },
  { href: "/ogretmenler", label: "Öğretmenler", icon: "◇" },
  { href: "/raporlar", label: "Raporlar", icon: "↗" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const institution = process.env.NEXT_PUBLIC_INSTITUTION_NAME || "Eğitim Kurumu";
  const demoMode = !process.env.NEXT_PUBLIC_SUPABASE_URL;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-800 bg-slate-950 text-white lg:flex lg:flex-col">
        <Brand institution={institution} />
        <Navigation pathname={pathname} onSelect={() => undefined} />
        <div className="mt-auto border-t border-slate-800 p-5">
          <Link href="/giris" className="block rounded-xl bg-white/10 px-4 py-3 text-sm font-medium hover:bg-white/15">
            Yönetici hesabı
          </Link>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Menüyü kapat" className="absolute inset-0 bg-slate-950/55" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-[85%] max-w-80 bg-slate-950 text-white shadow-2xl">
            <Brand institution={institution} />
            <Navigation pathname={pathname} onSelect={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-8">
          <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm lg:hidden" onClick={() => setOpen(true)}>
            Menü
          </button>
          <div className="hidden text-sm text-slate-500 sm:block">Kurum Yönetim Sistemi</div>
          <div className="flex items-center gap-3">
            {demoMode && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Demo modu</span>}
            <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white">Y</div>
          </div>
        </header>
        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function Brand({ institution }: { institution: string }) {
  return (
    <div className="border-b border-slate-800 p-6">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-amber-400 font-black text-slate-950">ŞS</div>
      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Yönetim Paneli</p>
      <h1 className="mt-2 text-base font-semibold leading-snug">{institution}</h1>
    </div>
  );
}

function Navigation({ pathname, onSelect }: { pathname: string; onSelect: () => void }) {
  return (
    <nav className="space-y-1 p-4">
      {navigation.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onSelect}
            className={cn(
              "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition",
              active ? "bg-amber-400 text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white",
            )}
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-current/10 text-base">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
