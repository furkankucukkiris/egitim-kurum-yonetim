import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <div className="rounded-3xl border border-line bg-panel p-8 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-100 dark:bg-rose-500/15 text-2xl text-rose-700 dark:text-rose-400">
          !
        </div>

        <h1 className="mt-5 text-2xl font-bold">
          Bu sayfaya erişim yetkiniz yok
        </h1>

        <p className="mt-3 text-sm leading-6 text-muted">
          Hesabınıza tanımlanan rol, bu bölümü görüntülemeye izin
          vermiyor.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white"
        >
          Ana sayfaya dön
        </Link>
      </div>
    </div>
  );
}