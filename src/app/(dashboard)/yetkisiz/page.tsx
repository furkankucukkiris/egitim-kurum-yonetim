import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-100 text-2xl text-rose-700">
          !
        </div>

        <h1 className="mt-5 text-2xl font-bold">
          Bu sayfaya erişim yetkiniz yok
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-500">
          Hesabınıza tanımlanan rol, bu bölümü görüntülemeye izin
          vermiyor.
        </p>

        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white"
        >
          Ana sayfaya dön
        </Link>
      </div>
    </div>
  );
}