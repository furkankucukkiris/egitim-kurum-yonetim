import type { ReactNode } from "react";

// Öğrenci, öğretmen, ders ve aday profillerinin ortak düzeni: solda
// fotoğraf/kimlik ve kısa bilgi kutuları (geniş ekranda sabit), sağda
// başlık kartı, bölüm sekmeleri ve bölümler. Dar ekranda alt alta.

export function ProfileLayout({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-20">{aside}</aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export type ProfileTab = { href: string; label: string };

export function ProfileHeader({
  title,
  badge,
  subtitle,
  children,
  tabs,
}: {
  title: string;
  badge?: ReactNode;
  subtitle?: ReactNode;
  // Başlığın altındaki serbest alan (ör. ders etiketleri).
  children?: ReactNode;
  tabs: ProfileTab[];
}) {
  return (
    <header className="rounded-2xl border border-border bg-surface">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-2xl font-semibold tracking-[-0.01em] text-text-primary md:text-[1.75rem]">
            {title}
          </h2>
          {badge}
        </div>

        {subtitle && <p className="mt-2 text-sm text-text-secondary">{subtitle}</p>}

        {children && <div className="mt-3">{children}</div>}
      </div>

      <nav
        aria-label="Profil bölümleri"
        className="scrollbar-hidden flex gap-1 overflow-x-auto border-t border-border px-3"
      >
        {tabs.map((tab) => (
          <a
            key={tab.href}
            href={tab.href}
            className="shrink-0 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
          >
            {tab.label}
          </a>
        ))}
      </nav>
    </header>
  );
}

// Sekmelerin kaydırdığı bölüm; yapışkan üst çubuğun altında kalmasın diye
// scroll-mt verilir.
export function ProfileSection({
  id,
  className = "mt-6",
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={`scroll-mt-20 ${className}`}>
      {children}
    </div>
  );
}

// Sağ sütunda başlıklı içerik kartı.
export function ProfileCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {description && <p className="mt-1 text-sm text-text-secondary">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

// Sol sütundaki küçük başlıklı kutu.
export function ProfileBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface">
      <h3 className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {title}
      </h3>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function ProfileFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-right font-medium text-text-primary">{value}</dd>
    </div>
  );
}

// Fotoğrafı olmayan kayıtlar için büyük kare kimlik kutusu.
export function ProfileAvatar({
  initials,
  tone = "neutral",
}: {
  initials: string;
  tone?: "neutral" | "brand";
}) {
  return (
    <div
      className={`grid aspect-square w-full place-items-center rounded-2xl border-4 border-surface shadow-md ring-1 ring-border ${
        tone === "brand" ? "bg-sidebar text-on-primary" : "bg-surface-muted text-text-secondary"
      }`}
    >
      <span className="text-5xl font-semibold tracking-wide">{initials}</span>
    </div>
  );
}

export function ProfileStatusBadge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>
  );
}

export function getNameInitials(fullName: string) {
  const names = fullName.trim().split(/\s+/).filter(Boolean);

  if (names.length === 0) return "?";
  if (names.length === 1) return names[0].slice(0, 2).toLocaleUpperCase("tr-TR");

  return `${names[0][0]}${names[names.length - 1][0]}`.toLocaleUpperCase("tr-TR");
}
