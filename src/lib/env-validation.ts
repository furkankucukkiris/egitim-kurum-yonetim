import "server-only";

// .env.example'daki gerçek placeholder metinleri — production'da bu
// değerlerin aynen bırakılmış olması, kurulumun tamamlanmadığının kesin
// göstergesidir (gerçek bir Supabase URL/anahtarıyla asla eşleşmezler).
const PLACEHOLDER_VALUES = new Set([
  "https://YOUR_PROJECT_REF.supabase.co",
  "YOUR_PROJECT_REF",
  "YOUR_PUBLISHABLE_KEY",
  "YOUR_SERVICE_ROLE_KEY",
]);

const REQUIRED_ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_INSTITUTION_NAME",
] as const;

function isPlaceholder(value: string) {
  return PLACEHOLDER_VALUES.has(value) || value.includes("YOUR_");
}

// Yalnızca gerçek production başlangıcında (next start / hosting
// sağlayıcısının cold start'ı) çalışır — `next build` sırasında
// instrumentation.ts'in register()'ı hiç tetiklenmez, bu yüzden CI'daki
// "Production Build" job'unun bilinçli olarak kullandığı placeholder
// build-env değerlerini (bkz. .github/workflows/ci.yml) etkilemez. `next
// dev` NODE_ENV=production set etmediğinden yerel geliştirme de
// etkilenmez.
export function validateProductionEnv() {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const missing: string[] = [];
  const placeholder: string[] = [];

  for (const key of REQUIRED_ENV_VARS) {
    const value = process.env[key];

    if (!value || value.trim() === "") {
      missing.push(key);
    } else if (isPlaceholder(value)) {
      placeholder.push(key);
    }
  }

  if (missing.length === 0 && placeholder.length === 0) {
    return;
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`eksik: ${missing.join(", ")}`);
  if (placeholder.length > 0) parts.push(`hâlâ .env.example placeholder değerinde: ${placeholder.join(", ")}`);

  throw new Error(
    `Production ortam değişkenleri hatalı (${parts.join("; ")}). ` +
      "Hosting sağlayıcınızın (ör. Vercel) Production/Preview ortam " +
      "değişkenleri ekranından gerçek Supabase proje değerlerini " +
      "tanımlayın — bkz. .env.example ve README bölüm 3.",
  );
}
