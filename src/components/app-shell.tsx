"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { logout } from "@/app/auth/actions";
import type { AppRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";

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

  return (
    <div className="min-h-screen bg-brand-50/40 text-brand-900">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-brand-900 bg-brand-900 text-white lg:flex lg:flex-col">
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
            className="absolute inset-0 bg-brand-900/55"
            onClick={() => setOpen(false)}
          />

          <aside className="relative flex h-full w-[85%] max-w-80 flex-col bg-brand-900 text-white shadow-2xl">
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
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-brand-100 bg-white/95 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            className="rounded-lg border border-brand-200 px-3 py-2 text-sm text-brand-700 lg:hidden"
            onClick={() => setOpen(true)}
          >
            Menü
          </button>

          <div className="hidden text-sm text-brand-500 sm:block">
            Kurum Yönetim Sistemi
          </div>

          <div title={userName}>
            <Avatar name={userName} size={36} />
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
    <div className="border-b border-white/10 p-6">
      <div className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-honey-500 font-black text-brand-900">
        ŞS
      </div>

      <p className="text-xs uppercase tracking-[0.2em] text-brand-200">
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
                ? "bg-honey-500 text-brand-900"
                : "text-brand-100 hover:bg-white/10 hover:text-white",
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
    <div className="mt-auto border-t border-white/10 p-5">
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={userName} size={32} />

        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {userName}
          </p>

          <p className="mt-0.5 text-xs text-brand-200">
            {roleLabels[userRole]}
          </p>
        </div>
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
