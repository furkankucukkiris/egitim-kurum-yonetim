"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-xl bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover active:scale-[0.98]"
    >
      Yazdır / Çıktı al
    </button>
  );
}
