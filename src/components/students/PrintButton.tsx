"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90"
    >
      Yazdır / Çıktı al
    </button>
  );
}
