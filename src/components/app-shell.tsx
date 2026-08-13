"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { logout } from "@/app/auth/actions";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Signature } from "@/components/branding/signature";

type NavigationItem = {
  href: string;
  label: string;
  icon: string;
  roles: AppRole[];
};

const navigation: NavigationItem[] = [
  {
    href: "/",
    label: "Genel Bakış",
    icon: "⌂",
    roles: ["admin"],
  },
  {
    href: "/ogretmen-paneli",
    label: "Programım",
    icon: "◫",
    roles: ["teacher"],
  },
  {
    href: "/ogrenciler",
    label: "Öğrenciler",
    icon: "◎",
    roles: ["admin"],
  },
  {
    href: "/aday-ogrenciler",
    label: "Aday Öğrenciler",
    icon: "☆",
    roles: ["admin"],
  },
  {
    href: "/dersler",
    label: "Dersler",
    icon: "▦",
    roles: ["admin"],
  },
  {
    href: "/program",
    label: "Ders Programı",
    icon: "◫",
    roles: ["admin"],
  },
  {
    href: "/bekleme-listesi",
    label: "Bekleme Listesi",
    icon: "◷",
    roles: ["admin"],
  },
  {
    href: "/odemeler",
    label: "Ödemeler",
    icon: "₺",
    roles: ["admin"],
  },
  {
    href: "/giderler",
    label: "Giderler",
    icon: "▾",
    roles: ["admin"],
  },
  {
    href: "/yoklama",
    label: "Yoklama",
    icon: "✓",
    roles: ["admin", "teacher"],
  },
  {
    href: "/ogretmenler",
    label: "Öğretmenler",
    icon: "◇",
    roles: ["admin"],
  },
  {
    href: "/hakedis",
    label: "Hakediş",
    icon: "◆",
    roles: ["admin"],
  },
  {
    href: "/raporlar",
    label: "Raporlar",
    icon: "↗",
    roles: ["admin"],
  },
  {
    href: "/meb-yoklama",
    label: "MEB Yoklama",
    icon: "✓",
    roles: ["admin", "teacher"],
  },
  {
    href: "/meb",
    label: "MEB Yönetimi",
    icon: "M",
    roles: ["admin"],
  },
  {
    href: "/kurum-ayarlari",
    label: "Kurum Ayarları",
    icon: "⚙",
    roles: ["admin"],
  },
];

const roleLabels: Record<AppRole, string> = {
  admin: "Yönetici",
  teacher: "Öğretmen",
};

type AppShellProps = {
  children: ReactNode;
  institution: string;
  institutionLogoUrl: string | null;
  userName: string;
  userRole: AppRole;
};

export function AppShell({
  children,
  institution,
  institutionLogoUrl,
  userName,
  userRole,
}: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const visibleNavigation = navigation.filter((item) => item.roles.includes(userRole));

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <aside className="print:hidden fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-sidebar-hover bg-sidebar text-sidebar-text lg:flex lg:flex-col">
        <Brand institution={institution} logoUrl={institutionLogoUrl} />

        <Navigation items={visibleNavigation} pathname={pathname} onSelect={() => undefined} />

        <AccountSection userName={userName} userRole={userRole} />

        <div className="border-t border-white/10 px-5 py-4">
          <Signature variant="sidebar" />
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Menüyü kapat"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          <aside className="relative flex h-full w-[85%] max-w-80 flex-col bg-sidebar text-sidebar-text shadow-2xl">
            <Brand institution={institution} logoUrl={institutionLogoUrl} />

            <Navigation
              items={visibleNavigation}
              pathname={pathname}
              onSelect={() => setOpen(false)}
            />

            <AccountSection userName={userName} userRole={userRole} />

        <div className="border-t border-white/10 px-5 py-4">
          <Signature variant="sidebar" />
        </div>
          </aside>
        </div>
      )}

      <div className="lg:pl-72 print:pl-0">
        <header className="print:hidden sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden"
            onClick={() => setOpen(true)}
          >
            Menü
          </button>

          <div className="hidden text-sm text-text-secondary sm:block">Kurum Yönetim Sistemi</div>

          <div title={userName}>
            <Avatar name={userName} size={36} />
          </div>
        </header>

        <main className="p-4 md:p-8 print:p-0">{children}</main>
      </div>
    </div>
  );
}

function Brand({ institution, logoUrl }: { institution: string; logoUrl: string | null }) {
  return (
    <div className="border-b border-white/10 p-6">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt={institution} className="mb-3 h-11 w-11 rounded-2xl object-cover" />
      ) : (
        <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-accent font-black text-on-accent">
          {getInitials(institution)}
        </div>
      )}

      <p className="text-xs font-medium uppercase tracking-[0.2em] text-sidebar-muted">
        Yönetim Paneli
      </p>

      <h1 className="mt-2 text-base font-semibold leading-snug">{institution}</h1>
    </div>
  );
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toLocaleUpperCase("tr-TR");
  }

  return `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase("tr-TR");
}

function Navigation({
  items,
  pathname,
  onSelect,
}: {
  items: NavigationItem[];
  pathname: string;
  onSelect: () => void;
}) {
  return (
    <nav className="scrollbar-hidden min-h-0 flex-1 space-y-1 overflow-y-auto p-4">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onSelect}
            className={cn(
              "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              active
                ? "bg-sidebar-active text-on-sidebar-active"
                : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-text",
            )}
            aria-current={active ? "page" : undefined}
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-current/10 text-base">
              {item.icon}
            </span>

            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AccountSection({ userName, userRole }: { userName: string; userRole: AppRole }) {
  return (
    <div className="mt-auto border-t border-white/10 p-5">
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={userName} size={32} />

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-text">{userName}</p>

          <p className="mt-0.5 text-xs text-sidebar-muted">{roleLabels[userRole]}</p>
        </div>
      </div>

      <form action={logout}>
        <button
          type="submit"
          className="w-full rounded-xl bg-sidebar-hover px-4 py-3 text-left text-sm font-medium text-sidebar-text transition-colors hover:bg-sidebar-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          Çıkış yap
        </button>
      </form>
    </div>
  );
}
