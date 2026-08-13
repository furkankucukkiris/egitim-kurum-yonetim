"use client";

import { logRegistrationFormPrint } from "./actions";

export function RegistrationFormPrintButton({ formId }: { formId: string }) {
  async function handleClick() {
    await logRegistrationFormPrint(formId);
    window.print();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="print:hidden rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover"
    >
      Yazdır / Çıktı al
    </button>
  );
}
