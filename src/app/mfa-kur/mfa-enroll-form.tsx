"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { storeMfaRecoveryCode } from "./actions";

type Step = "start" | "verify" | "recovery";

export function MfaEnrollForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function startEnroll() {
    setIsPending(true);
    setError(null);

    const supabase = createClient();

    // Önceki denemeden kalan doğrulanmamış bir factor varsa temizle —
    // aksi halde her yeniden deneme yeni bir sır/QR üretip kafa
    // karıştırır. `data.totp` yalnızca doğrulanmış factor'leri içerir
    // (bkz. supabase-js tipleri), doğrulanmamışlar için `data.all`
    // filtrelenmeli.
    const { data: existingFactors } = await supabase.auth.mfa.listFactors();

    for (const factor of existingFactors?.all ?? []) {
      if (factor.factor_type === "totp" && factor.status === "unverified") {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
    });

    setIsPending(false);

    if (enrollError || !data) {
      setError(enrollError?.message ?? "Kurulum başlatılamadı.");
      return;
    }

    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStep("verify");
  }

  async function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!factorId) {
      return;
    }

    setIsPending(true);
    setError(null);

    const supabase = createClient();

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });

    if (challengeError || !challenge) {
      setIsPending(false);
      setError(challengeError?.message ?? "Doğrulama başlatılamadı.");
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });

    if (verifyError) {
      setIsPending(false);
      setError("Kod doğrulanamadı. Authenticator uygulamanızdaki güncel 6 haneli kodu girin.");
      return;
    }

    const newRecoveryCode = generateRecoveryCode();
    const stored = await storeMfaRecoveryCode(newRecoveryCode);

    setIsPending(false);

    if (!stored.ok) {
      setError(stored.error ?? "Kurtarma kodu kaydedilemedi.");
      return;
    }

    setRecoveryCode(newRecoveryCode);
    setStep("recovery");
  }

  function finish() {
    router.push("/");
    router.refresh();
  }

  if (step === "start") {
    return (
      <div className="mt-6 space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
          >
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={startEnroll}
          disabled={isPending}
          className="w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
        >
          {isPending ? "Hazırlanıyor..." : "Kuruluma başla"}
        </button>
      </div>
    );
  }

  if (step === "verify") {
    return (
      <form onSubmit={handleVerify} className="mt-6 space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
          >
            {error}
          </div>
        )}

        <p className="text-sm leading-6 text-text-secondary">
          Google Authenticator, Microsoft Authenticator veya benzeri bir uygulamayla aşağıdaki QR
          kodu okutun.
        </p>

        {qrCode && (
          <div className="grid place-items-center rounded-xl bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/svg+xml;utf-8,${encodeURIComponent(qrCode)}`}
              alt="MFA QR kodu"
              className="h-48 w-48"
            />
          </div>
        )}

        {secret && (
          <p
            data-testid="mfa-secret"
            className="break-all rounded-xl bg-surface-muted p-3 text-center text-xs font-mono text-text-secondary"
          >
            QR okutulamıyorsa manuel anahtar: {secret}
          </p>
        )}

        <label className="block text-sm font-medium">
          Uygulamadaki 6 haneli kod
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-primary"
          />
        </label>

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
        >
          {isPending ? "Doğrulanıyor..." : "Doğrula ve etkinleştir"}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-xl border border-accent/30 bg-accent-soft p-4">
        <p className="text-sm font-semibold text-accent-strong">
          Kurtarma kodunuz — bu kod bir daha gösterilmeyecek
        </p>

        <p
          data-testid="mfa-recovery-code"
          className="mt-2 text-center text-xl font-mono font-bold tracking-widest text-text-primary"
        >
          {recoveryCode}
        </p>

        <p className="mt-2 text-xs leading-5 text-accent-strong">
          Authenticator uygulamanızı/telefonunuzu kaybederseniz giriş yapmanın tek yolu bu koddur.
          Güvenli, çevrimdışı bir yere (kağıt, parola yöneticisi) not edin.
        </p>
      </div>

      <label className="flex items-start gap-3 rounded-xl bg-surface-muted p-4">
        <input
          type="checkbox"
          checked={copied}
          onChange={(event) => setCopied(event.target.checked)}
          className="mt-1 h-4 w-4"
        />

        <span className="text-sm font-medium">Kurtarma kodunu güvenli bir yere kaydettim.</span>
      </label>

      <button
        type="button"
        onClick={finish}
        disabled={!copied}
        className="w-full rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 font-semibold text-on-primary transition hover:bg-primary-hover disabled:opacity-60"
      >
        Panele geç
      </button>
    </div>
  );
}

function generateRecoveryCode() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);

  // Karışabilecek karakterler (0/O, 1/I) hariç.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let result = "";

  for (const byte of bytes) {
    result += chars[byte % chars.length];
  }

  return `${result.slice(0, 5)}-${result.slice(5, 10)}`;
}
