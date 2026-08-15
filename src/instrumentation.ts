export async function register() {
  // Yalnızca Node.js runtime'da — Edge runtime'da (middleware) zaten
  // process.env doğrudan kullanılamıyor ve bu dosya orada da bir kez
  // çağrılıyor; validasyonu tek yerde, tek runtime'da tutuyoruz.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateProductionEnv } = await import("@/lib/env-validation");
    validateProductionEnv();
  }
}
