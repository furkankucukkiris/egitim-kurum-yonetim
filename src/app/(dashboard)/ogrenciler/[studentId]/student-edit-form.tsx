"use client";

import {
  useActionState,
  useState,
} from "react";
import { updateStudent } from "./actions";

type UpdateStudentState = {
  error: string | null;
};

const initialState: UpdateStudentState = {
  error: null,
};

type StudentEditFormProps = {
  student: {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: string;
    registrationDate: string;
    notes: string;
  };

  guardian: {
    id: string;
    fullName: string;
    phone: string;
    secondaryPhone: string;
    email: string;
    relationship: string;
    mayReceiveFinancialMessages: boolean;
  };
};

export function StudentEditForm({
  student,
  guardian,
}: StudentEditFormProps) {
  const [
    state,
    formAction,
    isPending,
  ] = useActionState(
    updateStudent,
    initialState,
  );

  const [values, setValues] = useState({
    studentFirstName: student.firstName,
    studentLastName: student.lastName,
    birthDate: student.birthDate,
    registrationDate: student.registrationDate,
    studentNotes: student.notes,

    guardianFullName: guardian.fullName,
    guardianPhone: guardian.phone,
    guardianSecondaryPhone:
      guardian.secondaryPhone,
    guardianEmail: guardian.email,
    relationship: guardian.relationship,

    mayReceiveFinancialMessages:
      guardian.mayReceiveFinancialMessages,
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
    <form
      action={formAction}
      className="space-y-6"
    >
      <input
        type="hidden"
        name="studentId"
        value={student.id}
      />

      <input
        type="hidden"
        name="primaryGuardianId"
        value={guardian.id}
      />

      {state.error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          {state.error}
        </div>
      )}

      <section className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">
          Öğrenci bilgileri
        </h2>

        <p className="mt-1 text-sm text-gray-500">
          T.C. kimlik numarası güvenlik nedeniyle bu ekranda gösterilmez.
        </p>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Field
            label="Öğrenci adı"
            name="studentFirstName"
            value={values.studentFirstName}
            required
            onChange={(value) =>
              updateValue(
                "studentFirstName",
                value,
              )
            }
          />

          <Field
            label="Öğrenci soyadı"
            name="studentLastName"
            value={values.studentLastName}
            required
            onChange={(value) =>
              updateValue(
                "studentLastName",
                value,
              )
            }
          />

          <Field
            label="Doğum tarihi"
            name="birthDate"
            type="date"
            value={values.birthDate}
            onChange={(value) =>
              updateValue("birthDate", value)
            }
          />

          <Field
            label="Kayıt tarihi"
            name="registrationDate"
            type="date"
            value={values.registrationDate}
            required
            onChange={(value) =>
              updateValue(
                "registrationDate",
                value,
              )
            }
          />
        </div>

        <label className="mt-5 block text-sm font-medium">
          Öğrenci notu

          <textarea
            name="studentNotes"
            rows={4}
            value={values.studentNotes}
            onChange={(event) =>
              updateValue(
                "studentNotes",
                event.target.value,
              )
            }
            className="mt-2 w-full rounded-xl border border-brand-100 px-4 py-3 text-sm outline-none focus:border-gray-400"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">
          Birincil veli
        </h2>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Field
            label="Veli adı soyadı"
            name="guardianFullName"
            value={values.guardianFullName}
            required
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
              <option value="Anne">Anne</option>
              <option value="Baba">Baba</option>
              <option value="Vasi">Vasi</option>
              <option value="Aile yakını">
                Aile yakını
              </option>
              <option value="Diğer">Diğer</option>
            </select>
          </label>

          <Field
            label="Cep telefonu"
            name="guardianPhone"
            type="tel"
            value={values.guardianPhone}
            required
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

        <label className="mt-5 flex items-start gap-3 rounded-xl bg-brand-50 p-4">
          <input
            type="checkbox"
            name="mayReceiveFinancialMessages"
            checked={
              values.mayReceiveFinancialMessages
            }
            onChange={(event) =>
              updateValue(
                "mayReceiveFinancialMessages",
                event.target.checked,
              )
            }
            className="mt-1 h-4 w-4"
          />

          <span>
            <span className="block text-sm font-semibold">
              Finansal mesajları alabilir
            </span>

            <span className="mt-1 block text-xs leading-5 text-gray-500">
              Ödeme hatırlatmaları ve borç bilgilendirmeleri bu veliye gönderilebilir.
            </span>
          </span>
        </label>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-terra-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isPending
            ? "Kaydediliyor..."
            : "Değişiklikleri kaydet"}
        </button>
      </div>
    </form>
  );
}

type FieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
};

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
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
        required={required}
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
        className="mt-2 w-full rounded-xl border border-brand-100 px-4 py-3 text-sm outline-none focus:border-gray-400"
      />
    </label>
  );
}