"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createStudent } from "./actions";
import { StudentPhotoField } from "@/components/students/StudentPhotoField";

type CreateStudentState = {
  error: string | null;
};

const initialCreateStudentState: CreateStudentState = {
  error: null,
};

type StudentFormProps = {
  initialRegistrationDate: string;
};

type FormValues = {
  studentIdentityNumber: string;
  studentFirstName: string;
  studentLastName: string;
  birthDate: string;
  registrationDate: string;
  studentNotes: string;

  guardianIdentityNumber: string;
  guardianFullName: string;
  relationship: string;
  guardianPhone: string;
  guardianSecondaryPhone: string;
  guardianEmail: string;
};

export function StudentForm({ initialRegistrationDate }: StudentFormProps) {
  const [state, formAction, isPending] = useActionState(createStudent, initialCreateStudentState);

  const [values, setValues] = useState<FormValues>({
    studentIdentityNumber: "",
    studentFirstName: "",
    studentLastName: "",
    birthDate: "",
    registrationDate: initialRegistrationDate,
    studentNotes: "",

    guardianIdentityNumber: "",
    guardianFullName: "",
    relationship: "Anne",
    guardianPhone: "",
    guardianSecondaryPhone: "",
    guardianEmail: "",
  });

  function updateValue(field: keyof FormValues, value: string) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <form action={formAction} className="mx-auto max-w-4xl space-y-6">
      {state.error && (
        <div
          role="alert"
          className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm leading-6 text-danger"
        >
          {state.error}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm md:p-7">
        <div className="border-b border-primary-soft pb-4">
          <h2 className="text-lg font-bold">Öğrenci bilgileri</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Öğrencinin kimlik ve kurum kayıt bilgileri.
          </p>
        </div>

        <div className="mt-5">
          <StudentPhotoField />
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <FormField
              label="Öğrenci T.C. kimlik numarası"
              name="studentIdentityNumber"
              required
              inputMode="numeric"
              maxLength={11}
              pattern="[0-9]{11}"
              autoComplete="off"
              placeholder="11 haneli T.C. kimlik numarası"
              value={values.studentIdentityNumber}
              onChange={(value) =>
                updateValue("studentIdentityNumber", value.replace(/\D/g, "").slice(0, 11))
              }
              helperText="Bu bilgi öğrenci listesinde gösterilmez."
            />
          </div>

          <FormField
            label="Öğrenci adı"
            name="studentFirstName"
            required
            autoComplete="given-name"
            placeholder="Öğrencinin adı"
            value={values.studentFirstName}
            onChange={(value) => updateValue("studentFirstName", value)}
          />

          <FormField
            label="Öğrenci soyadı"
            name="studentLastName"
            required
            autoComplete="family-name"
            placeholder="Öğrencinin soyadı"
            value={values.studentLastName}
            onChange={(value) => updateValue("studentLastName", value)}
          />

          <FormField
            label="Doğum tarihi"
            name="birthDate"
            type="date"
            value={values.birthDate}
            onChange={(value) => updateValue("birthDate", value)}
          />

          <FormField
            label="Kayıt tarihi"
            name="registrationDate"
            type="date"
            required
            value={values.registrationDate}
            onChange={(value) => updateValue("registrationDate", value)}
          />
        </div>

        <label className="mt-5 block text-sm font-medium">
          Öğrenci notu
          <textarea
            name="studentNotes"
            rows={4}
            value={values.studentNotes}
            onChange={(event) => updateValue("studentNotes", event.target.value)}
            placeholder="Kayıt sırasında bilinmesi gereken kısa notlar..."
            className="mt-2 w-full resize-y rounded-xl border border-border px-4 py-3 text-sm outline-none transition focus:border-primary"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm md:p-7">
        <div className="border-b border-primary-soft pb-4">
          <h2 className="text-lg font-bold">Birincil veli bilgileri</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Ödeme ve kurum iletişiminde öncelikli kullanılacak veli.
          </p>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <FormField
              label="Veli T.C. kimlik numarası"
              name="guardianIdentityNumber"
              required
              inputMode="numeric"
              maxLength={11}
              pattern="[0-9]{11}"
              autoComplete="off"
              placeholder="11 haneli T.C. kimlik numarası"
              value={values.guardianIdentityNumber}
              onChange={(value) =>
                updateValue("guardianIdentityNumber", value.replace(/\D/g, "").slice(0, 11))
              }
              helperText="Aynı veliye bağlı kardeş öğrenciler bu numara üzerinden eşleştirilir."
            />
          </div>

          <FormField
            label="Veli adı soyadı"
            name="guardianFullName"
            required
            autoComplete="name"
            placeholder="Velinin adı ve soyadı"
            value={values.guardianFullName}
            onChange={(value) => updateValue("guardianFullName", value)}
          />

          <label className="block text-sm font-medium">
            Yakınlık durumu
            <select
              name="relationship"
              value={values.relationship}
              onChange={(event) => updateValue("relationship", event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
            >
              <option value="Anne">Anne</option>

              <option value="Baba">Baba</option>

              <option value="Vasi">Vasi</option>

              <option value="Aile yakını">Aile yakını</option>

              <option value="Diğer">Diğer</option>
            </select>
          </label>

          <FormField
            label="Cep telefonu"
            name="guardianPhone"
            type="tel"
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="05xx xxx xx xx"
            value={values.guardianPhone}
            onChange={(value) => updateValue("guardianPhone", value)}
          />

          <FormField
            label="İkinci telefon"
            name="guardianSecondaryPhone"
            type="tel"
            inputMode="tel"
            placeholder="İsteğe bağlı"
            value={values.guardianSecondaryPhone}
            onChange={(value) => updateValue("guardianSecondaryPhone", value)}
          />

          <div className="md:col-span-2">
            <FormField
              label="E-posta"
              name="guardianEmail"
              type="email"
              autoComplete="email"
              placeholder="İsteğe bağlı"
              value={values.guardianEmail}
              onChange={(value) => updateValue("guardianEmail", value)}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link
          href="/ogrenciler"
          className="rounded-xl border border-border bg-surface px-5 py-3 text-center text-sm font-semibold text-primary transition hover:bg-surface-muted"
        >
          Vazgeç
        </Link>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Öğrenci kaydediliyor..." : "Öğrenciyi kaydet"}
        </button>
      </div>
    </form>
  );
}

type FormFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;

  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal";

  maxLength?: number;
  pattern?: string;
  helperText?: string;
};

function FormField({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
  autoComplete,
  inputMode,
  maxLength,
  pattern,
  helperText,
}: FormFieldProps) {
  return (
    <label className="block text-sm font-medium">
      {label}

      {required && <span className="ml-1 text-danger text-danger">*</span>}

      <input
        name={name}
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        pattern={pattern}
        className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none transition focus:border-primary"
      />

      {helperText && (
        <span className="mt-2 block text-xs leading-5 text-text-secondary">{helperText}</span>
      )}
    </label>
  );
}
