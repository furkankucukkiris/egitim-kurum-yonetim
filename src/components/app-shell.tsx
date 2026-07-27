"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { logout } from "@/app/auth/actions";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";

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
    roles: ["admin", "finance", "viewer"],
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
    roles: ["admin", "finance"],
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
    href: "/odemeler",
    label: "Ödemeler",
    icon: "₺",
    roles: ["admin", "finance"],
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
    href: "/raporlar",
    label: "Raporlar",
    icon: "↗",
    roles: ["admin", "finance", "viewer"],
  },
  {
    href: "/meb-yoklama",
    label: "MEB Yoklama",
    icon: "✓",
    roles: [
      "admin",
      "finance",
      "teacher",
    ],
  },
  {
    href: "/meb",
    label: "MEB Yönetimi",
    icon: "M",
    roles: ["admin"],
  },
];

const roleLabels: Record<AppRole, string> = {
  admin: "Yönetici",
  finance: "Finans",
  teacher: "Öğretmen",
  viewer: "Görüntüleyici",
};

type AppShellProps = {
  children: ReactNode;
  institution: string;
  userName: string;
  userRole: AppRole;
};

export function AppShell({
  children,
  institution,
  userName,
  userRole,
}: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const visibleNavigation = navigation.filter((item) =>
    item.roles.includes(userRole),
  );

  const initials = getInitials(userName);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-slate-800 bg-slate-950 text-white lg:flex lg:flex-col">
        <Brand institution={institution} />

        <Navigation
          items={visibleNavigation}
          pathname={pathname}
          onSelect={() => undefined}
        />

        <AccountSection
          userName={userName}
          userRole={userRole}
        />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Menüyü kapat"
            className="absolute inset-0 bg-slate-950/55"
            onClick={() => setOpen(false)}
          />

          <aside className="relative flex h-full w-[85%] max-w-80 flex-col bg-slate-950 text-white shadow-2xl">
            <Brand institution={institution} />

            <Navigation
              items={visibleNavigation}
              pathname={pathname}
              onSelect={() => setOpen(false)}
            />

            <AccountSection
              userName={userName}
              userRole={userRole}
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm lg:hidden"
            onClick={() => setOpen(true)}
          >
            Menü
          </button>

          <div className="hidden text-sm text-slate-500 sm:block">
            Kurum Yönetim Sistemi
          </div>

          <div
            className="grid h-9 w-9 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white"
            title={userName}
          >
            {initials}
          </div>
        </header>

        <main className="p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}

function Brand({
  institution,
}: {
  institution: string;
}) {
  return (
    <div className="border-b border-slate-800 p-6">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-amber-400 font-black text-slate-950">
        ŞS
      </div>

      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
        Yönetim Paneli
      </p>

      <h1 className="mt-2 text-base font-semibold leading-snug">
        {institution}
      </h1>
    </div>
  );
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
    <nav className="space-y-1 p-4">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onSelect}
            className={cn(
              "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition",
              active
                ? "bg-amber-400 text-slate-950"
                : "text-slate-300 hover:bg-white/10 hover:text-white",
            )}
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

function AccountSection({
  userName,
  userRole,
}: {
  userName: string;
  userRole: AppRole;
}) {
  return (
    <div className="mt-auto border-t border-slate-800 p-5">
      <div className="mb-4">
        <p className="truncate text-sm font-semibold text-white">
          {userName}
        </p>

        <p className="mt-1 text-xs text-slate-400">
          {roleLabels[userRole]}
        </p>
      </div>

      <form action={logout}>
        <button
          type="submit"
          className="w-full rounded-xl bg-white/10 px-4 py-3 text-left text-sm font-medium text-white transition hover:bg-white/15"
        >
          Çıkış yap
        </button>
      </form>
    </div>
  );
}

function getInitials(fullName: string) {
  const names = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (names.length === 0) {
    return "Y";
  }

  if (names.length === 1) {
    return names[0].slice(0, 2).toLocaleUpperCase("tr-TR");
  }

  return `${names[0][0]}${names[names.length - 1][0]}`.toLocaleUpperCase(
    "tr-TR",
  );
}
