"use client";

import Link from "next/link";
import {
  useActionState,
  useState,
} from "react";
import {
  createCourse,
  updateCourse,
} from "./actions";

type CourseActionState = {
  error: string | null;
};

const initialState: CourseActionState = {
  error: null,
};

type CourseFormProps = {
  mode: "create" | "edit";

  course?: {
    id: string;
    name: string;
    code: string;
    courseType: "individual" | "group";
    durationMinutes: number;
    monthlyFee: number;
  };
};

export function CourseForm({
  mode,
  course,
}: CourseFormProps) {
  const action =
    mode === "create"
      ? createCourse
      : updateCourse;

  const [
    state,
    formAction,
    isPending,
  ] = useActionState(
    action,
    initialState,
  );

  const [values, setValues] = useState({
    name: course?.name ?? "",
    code: course?.code ?? "",
    courseType:
      course?.courseType ?? "individual",
    durationMinutes: String(
      course?.durationMinutes ?? 60,
    ),
    monthlyFee: String(
      course?.monthlyFee ?? "",
    ),
  });

  function updateValue(
    field: keyof typeof values,
    value: string,
  ) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <form
      action={formAction}
      className="mx-auto max-w-3xl space-y-6"
    >
      {mode === "edit" && course && (
        <input
          type="hidden"
          name="courseId"
          value={course.id}
        />
      )}

      {state.error && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"
        >
          {state.error}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">
          Ders bilgileri
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          Öğrencinin özel fiyatı daha sonra ders kaydı sırasında ayrıca belirlenebilecektir.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Ders adı
            <span className="ml-1 text-rose-600">
              *
            </span>

            <input
              name="name"
              required
              minLength={2}
              value={values.name}
              onChange={(event) =>
                updateValue(
                  "name",
                  event.target.value,
                )
              }
              placeholder="Örneğin: Piyano"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
            />
          </label>

          <label className="block text-sm font-medium">
            Ders kodu

            <input
              name="code"
              value={values.code}
              onChange={(event) =>
                updateValue(
                  "code",
                  event.target.value,
                )
              }
              placeholder="Örneğin: PIYANO"
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm uppercase outline-none focus:border-slate-400"
            />

            <span className="mt-2 block text-xs text-slate-500">
              İsteğe bağlıdır ancak raporlarda kolaylık sağlar.
            </span>
          </label>

          <label className="block text-sm font-medium">
            Ders türü
            <span className="ml-1 text-rose-600">
              *
            </span>

            <select
              name="courseType"
              value={values.courseType}
              onChange={(event) =>
                updateValue(
                  "courseType",
                  event.target.value,
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400"
            >
              <option value="individual">
                Birebir ders
              </option>

              <option value="group">
                Grup dersi
              </option>
            </select>
          </label>

          <label className="block text-sm font-medium">
            Varsayılan ders süresi
            <span className="ml-1 text-rose-600">
              *
            </span>

            <input
              name="durationMinutes"
              type="number"
              required
              min={15}
              max={480}
              step={5}
              value={values.durationMinutes}
              onChange={(event) =>
                updateValue(
                  "durationMinutes",
                  event.target.value,
                )
              }
              className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-400"
            />

            <span className="mt-2 block text-xs text-slate-500">
              Dakika olarak girin. Örneğin birebir piyano için 50.
            </span>
          </label>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium">
              Varsayılan aylık ücret
              <span className="ml-1 text-rose-600">
                *
              </span>

              <div className="mt-2 flex rounded-xl border border-slate-200 bg-white focus-within:border-slate-400">
                <span className="grid place-items-center border-r border-slate-200 px-4 text-sm font-semibold text-slate-500">
                  TL
                </span>

                <input
                  name="monthlyFee"
                  required
                  inputMode="decimal"
                  value={values.monthlyFee}
                  onChange={(event) =>
                    updateValue(
                      "monthlyFee",
                      event.target.value,
                    )
                  }
                  placeholder="Örneğin: 4400"
                  className="w-full rounded-r-xl px-4 py-3 text-sm outline-none"
                />
              </div>

              <span className="mt-2 block text-xs text-slate-500">
                4400 veya 4400,00 biçiminde girin. Binlik ayırıcı kullanmayın.
              </span>
            </label>
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link
          href="/dersler"
          className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700"
        >
          Vazgeç
        </Link>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isPending
            ? "Kaydediliyor..."
            : mode === "create"
              ? "Dersi oluştur"
              : "Değişiklikleri kaydet"}
        </button>
      </div>
    </form>
  );
}