"use client";

import {
  useActionState,
  useState,
} from "react";

import {
  addGuardian,
  removeGuardian,
  setPrimaryGuardian,
} from "./actions";

type GuardianItem = {
  id: string;
  fullName: string;
  phone: string;
  secondaryPhone: string;
  email: string;
  relationship: string;
  isPrimary: boolean;
  mayReceiveFinancialMessages: boolean;
};

type GuardianManagementProps = {
  studentId: string;
  guardians: GuardianItem[];
  isArchived: boolean;
};

type AddGuardianState = {
  error: string | null;
};

const initialState: AddGuardianState = {
  error: null,
};

export function GuardianManagement({
  studentId,
  guardians,
  isArchived,
}: GuardianManagementProps) {
  const [addFormOpen, setAddFormOpen] =
    useState(false);

  const [
    state,
    formAction,
    isPending,
  ] = useActionState(
    addGuardian,
    initialState,
  );

  const [values, setValues] = useState({
    guardianIdentityNumber: "",
    guardianFullName: "",
    guardianPhone: "",
    guardianSecondaryPhone: "",
    guardianEmail: "",
    relationship: "Baba",
    isPrimary: false,
    mayReceiveFinancialMessages: true,
  });

  function updateValue(
    field: keyof typeof values,
    value: string | boolean,
  ) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <section className="mt-8 rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-brand-50 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold">
            Veli bağlantıları
          </h2>

          <p className="mt-1 text-sm text-gray-500">
            Öğrenciye bağlı anne, baba, vasi ve diğer iletişim kişileri.
          </p>
        </div>

        {!isArchived && (
          <button
            type="button"
            onClick={() =>
              setAddFormOpen((current) => !current)
            }
            className="rounded-xl bg-terra-700 px-4 py-3 text-sm font-semibold text-white"
          >
            {addFormOpen
              ? "Formu kapat"
              : "+ Veli ekle"}
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {guardians.map((guardian) => (
          <article
            key={guardian.id}
            className="rounded-2xl border border-brand-100 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold">
                  {guardian.fullName}
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  {guardian.relationship}
                </p>
              </div>

              {guardian.isPrimary && (
                <span className="rounded-full bg-honey-100 px-3 py-1 text-xs font-semibold text-honey-700">
                  Birincil veli
                </span>
              )}
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="font-medium text-gray-500">
                  Telefon:
                </dt>

                <dd>
                  {guardian.phone}
                </dd>
              </div>

              {guardian.secondaryPhone && (
                <div className="flex gap-2">
                  <dt className="font-medium text-gray-500">
                    İkinci telefon:
                  </dt>

                  <dd>
                    {guardian.secondaryPhone}
                  </dd>
                </div>
              )}

              {guardian.email && (
                <div className="flex gap-2">
                  <dt className="font-medium text-gray-500">
                    E-posta:
                  </dt>

                  <dd className="break-all">
                    {guardian.email}
                  </dd>
                </div>
              )}

              <div className="flex gap-2">
                <dt className="font-medium text-gray-500">
                  Finansal mesaj:
                </dt>

                <dd>
                  {guardian.mayReceiveFinancialMessages
                    ? "Alabilir"
                    : "Alamaz"}
                </dd>
              </div>
            </dl>

            {!isArchived && (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-brand-50 pt-4">
                {!guardian.isPrimary && (
                  <form action={setPrimaryGuardian}>
                    <input
                      type="hidden"
                      name="studentId"
                      value={studentId}
                    />

                    <input
                      type="hidden"
                      name="guardianId"
                      value={guardian.id}
                    />

                    <button
                      type="submit"
                      className="rounded-lg border border-honey-100 bg-honey-50 px-3 py-2 text-xs font-semibold text-honey-700"
                    >
                      Birincil yap
                    </button>
                  </form>
                )}

                <form
                  action={removeGuardian}
                  onSubmit={(event) => {
                    const accepted =
                      window.confirm(
                        `${guardian.fullName} adlı velinin öğrenci bağlantısı kaldırılsın mı?`,
                      );

                    if (!accepted) {
                      event.preventDefault();
                    }
                  }}
                >
                  <input
                    type="hidden"
                    name="studentId"
                    value={studentId}
                  />

                  <input
                    type="hidden"
                    name="guardianId"
                    value={guardian.id}
                  />

                  <button
                    type="submit"
                    disabled={guardians.length <= 1}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Bağlantıyı kaldır
                  </button>
                </form>
              </div>
            )}
          </article>
        ))}
      </div>

      {guardians.length === 1 && !isArchived && (
        <p className="mt-4 text-xs text-gray-500">
          Öğrencinin tek veli bağlantısı kaldırılamaz. Önce ikinci bir veli ekleyin.
        </p>
      )}

      {addFormOpen && !isArchived && (
        <form
          action={formAction}
          className="mt-7 rounded-2xl border border-brand-100 bg-brand-50 p-5"
        >
          <input
            type="hidden"
            name="studentId"
            value={studentId}
          />

          <h3 className="font-bold">
            Yeni veli bağlantısı
          </h3>

          <p className="mt-1 text-sm text-gray-500">
            Aynı T.C. kimlik numarası daha önce kaydedilmişse mevcut veli kullanılır.
          </p>

          {state.error && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
            >
              {state.error}
            </div>
          )}

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field
                label="Veli T.C. kimlik numarası"
                name="guardianIdentityNumber"
                required
                inputMode="numeric"
                maxLength={11}
                pattern="[0-9]{11}"
                autoComplete="off"
                value={values.guardianIdentityNumber}
                onChange={(value) =>
                  updateValue(
                    "guardianIdentityNumber",
                    value
                      .replace(/\D/g, "")
                      .slice(0, 11),
                  )
                }
              />
            </div>

            <Field
              label="Veli adı soyadı"
              name="guardianFullName"
              required
              value={values.guardianFullName}
              onChange={(value) =>
                updateValue(
                  "guardianFullName",
                  value,
                )
              }
            />

            <label className="block text-sm font-medium">
              Yakınlık durumu

              <select
                name="relationship"
                value={values.relationship}
                onChange={(event) =>
                  updateValue(
                    "relationship",
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-xl border border-brand-100 bg-white px-4 py-3 text-sm"
              >
                <option value="Anne">
                  Anne
                </option>

                <option value="Baba">
                  Baba
                </option>

                <option value="Vasi">
                  Vasi
                </option>

                <option value="Aile yakını">
                  Aile yakını
                </option>

                <option value="Diğer">
                  Diğer
                </option>
              </select>
            </label>

            <Field
              label="Cep telefonu"
              name="guardianPhone"
              type="tel"
              required
              inputMode="tel"
              value={values.guardianPhone}
              onChange={(value) =>
                updateValue(
                  "guardianPhone",
                  value,
                )
              }
            />

            <Field
              label="İkinci telefon"
              name="guardianSecondaryPhone"
              type="tel"
              inputMode="tel"
              value={values.guardianSecondaryPhone}
              onChange={(value) =>
                updateValue(
                  "guardianSecondaryPhone",
                  value,
                )
              }
            />

            <div className="md:col-span-2">
              <Field
                label="E-posta"
                name="guardianEmail"
                type="email"
                value={values.guardianEmail}
                onChange={(value) =>
                  updateValue(
                    "guardianEmail",
                    value,
                  )
                }
              />
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <CheckboxField
              name="mayReceiveFinancialMessages"
              checked={
                values.mayReceiveFinancialMessages
              }
              onChange={(checked) =>
                updateValue(
                  "mayReceiveFinancialMessages",
                  checked,
                )
              }
              title="Finansal mesajları alabilir"
              description="Ödeme hatırlatmaları ve borç bildirimleri bu veliye gönderilebilir."
            />

            <CheckboxField
              name="isPrimary"
              checked={values.isPrimary}
              onChange={(checked) =>
                updateValue(
                  "isPrimary",
                  checked,
                )
              }
              title="Birincil veli yap"
              description="Etkinleştirilirse mevcut birincil veli ikincil duruma geçer."
            />
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-xl bg-terra-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isPending
                ? "Veli ekleniyor..."
                : "Veliyi kaydet"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

type FieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;

  type?: string;
  required?: boolean;
  inputMode?:
    | "text"
    | "tel"
    | "email"
    | "numeric"
    | "decimal";

  maxLength?: number;
  pattern?: string;
  autoComplete?: string;
};

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  inputMode,
  maxLength,
  pattern,
  autoComplete,
}: FieldProps) {
  return (
    <label className="block text-sm font-medium">
      {label}

      {required && (
        <span className="ml-1 text-rose-600">
          *
        </span>
      )}

      <input
        name={name}
        type={type}
        value={value}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
        pattern={pattern}
        autoComplete={autoComplete}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-2 w-full rounded-xl border border-brand-100 bg-white px-4 py-3 text-sm outline-none focus:border-gray-400"
      />
    </label>
  );
}

type CheckboxFieldProps = {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
};

function CheckboxField({
  name,
  checked,
  onChange,
  title,
  description,
}: CheckboxFieldProps) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-brand-100 bg-white p-4">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(event) =>
          onChange(event.target.checked)
        }
        className="mt-1 h-4 w-4"
      />

      <span>
        <span className="block text-sm font-semibold">
          {title}
        </span>

        <span className="mt-1 block text-xs leading-5 text-gray-500">
          {description}
        </span>
      </span>
    </label>
  );
}