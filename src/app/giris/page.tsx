import Link from "next/link";
import { login } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Güvenli giriş</p>
        <h2 className="mt-3 text-2xl font-bold">Yönetim hesabı</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">Supabase projesi bağlandıktan sonra kurum kullanıcıları e-posta ve parola ile giriş yapabilir.</p>
        {error && <div className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
        <form action={login} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">E-posta<input name="email" type="email" required className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-400" /></label>
          <label className="block text-sm font-medium">Parola<input name="password" type="password" required minLength={8} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-400" /></label>
          <button className="w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white">Giriş yap</button>
        </form>
        <Link href="/" className="mt-5 block text-center text-sm font-medium text-slate-600 underline underline-offset-4">Demo panele dön</Link>
      </div>
    </div>
  );
}
