"use client";

import { useActionState, useState } from "react";
import { updateRegistrationDetails } from "./actions";

type UpdateRegistrationDetailsState = {
  error: string | null;
};

const initialState: UpdateRegistrationDetailsState = {
  error: null,
};

type RegistrationDetailsManagementProps = {
  studentId: string;

  details: {
    homeAddress: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    healthNotes: string;
    photoVideoConsent: "izinli" | "sadece_kurum_ici" | "izinsiz";
    kvkkConsentAccepted: boolean;
    institutionRulesAccepted: boolean;
  };
};

export function RegistrationDetailsManagement({
  studentId,
  details,
}: RegistrationDetailsManagementProps) {
  const [state, formAction, isPending] = useActionState(updateRegistrationDetails, initialState);

  const [values, setValues] = useState({
    homeAddress: details.homeAddress,
    emergencyContactName: details.emergencyContactName,
    emergencyContactPhone: details.emergencyContactPhone,
    healthNotes: details.healthNotes,
    photoVideoConsent: details.photoVideoConsent,
    kvkkConsentAccepted: details.kvkkConsentAccepted,
    institutionRulesAccepted: details.institutionRulesAccepted,
  });

  function updateValue(field: keyof typeof values, value: string | boolean) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <form action={formAction} className="mt-8">
      <input type="hidden" name="studentId" value={studentId} />

      <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-bold">Resmî kayıt formu bilgileri</h2>

        <p className="mt-1 text-sm text-text-secondary">
          Bu alanlar yalnızca yöneticiler tarafından görülür ve resmî kayıt formuna işlenir.
          Sağlık/alerji notu hassas veridir.
        </p>

        {state.error && (
          <div
            role="alert"
            className="mt-4 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
          >
            {state.error}
          </div>
        )}

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium">
              Adres
              <textarea
                name="homeAddress"
                rows={2}
                value={values.homeAddress}
                onChange={(event) => updateValue("homeAddress", event.target.value)}
                className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="block text-sm font-medium">
            Acil durumda aranacak kişi
            <input
              name="emergencyContactName"
              type="text"
              value={values.emergencyContactName}
              onChange={(event) => updateValue("emergencyContactName", event.target.value)}
              className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="block text-sm font-medium">
            Acil durum telefonu
            <input
              name="emergencyContactPhone"
              type="tel"
              value={values.emergencyContactPhone}
              onChange={(event) => updateValue("emergencyContactPhone", event.target.value)}
              className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-primary"
            />
          </label>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium">
              Sağlık / alerji bilgisi
              <textarea
                name="healthNotes"
                rows={3}
                value={values.healthNotes}
                onChange={(event) => updateValue("healthNotes", event.target.value)}
                className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="block text-sm font-medium">
            Fotoğraf / video kullanım tercihi
            <select
              name="photoVideoConsent"
              value={values.photoVideoConsent}
              onChange={(event) => updateValue("photoVideoConsent", event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            >
              <option value="izinli">İzinli (genel kullanım)</option>
              <option value="sadece_kurum_ici">Yalnızca kurum içi kullanım</option>
              <option value="izinsiz">İzinsiz</option>
            </select>
          </label>
        </div>

        <div className="mt-5 space-y-3">
          <label className="flex items-start gap-3 rounded-xl bg-surface-muted p-4">
            <input
              type="checkbox"
              name="institutionRulesAccepted"
              checked={values.institutionRulesAccepted}
              onChange={(event) => updateValue("institutionRulesAccepted", event.target.checked)}
              className="mt-1 h-4 w-4"
            />

            <span>
              <span className="block text-sm font-semibold">Kurum kurallarını kabul etti</span>

              <span className="mt-1 block text-xs leading-5 text-text-secondary">
                Kayıt formunda gösterilecek kurum kuralları metnini veli/öğrenci kabul etti.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 rounded-xl bg-surface-muted p-4">
            <input
              type="checkbox"
              name="kvkkConsentAccepted"
              checked={values.kvkkConsentAccepted}
              onChange={(event) => updateValue("kvkkConsentAccepted", event.target.checked)}
              className="mt-1 h-4 w-4"
            />

            <span>
              <span className="block text-sm font-semibold">
                KVKK aydınlatma metnini kabul etti
              </span>

              <span className="mt-1 block text-xs leading-5 text-text-secondary">
                Onay tarihi işaretlendiğinde otomatik olarak kaydedilir.
              </span>
            </span>
          </label>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {isPending ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </section>
    </form>
  );
}
