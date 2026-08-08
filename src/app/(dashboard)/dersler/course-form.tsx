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
          className="rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400"
        >
          {state.error}
        </div>
      )}

      <section className="rounded-2xl border border-line bg-panel p-6 shadow-sm">
        <h2 className="text-lg font-bold">
          Ders bilgileri
        </h2>

        <p className="mt-1 text-sm text-muted">
          Öğrencinin özel fiyatı daha sonra ders kaydı sırasında ayrıca belirlenebilecektir.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Ders adı
            <span className="ml-1 text-rose-600 dark:text-rose-400">
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
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-terra-500"
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
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm uppercase outline-none focus:border-terra-500"
            />

            <span className="mt-2 block text-xs text-muted">
              İsteğe bağlıdır ancak raporlarda kolaylık sağlar.
            </span>
          </label>

          <label className="block text-sm font-medium">
            Ders türü
            <span className="ml-1 text-rose-600 dark:text-rose-400">
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
              className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none focus:border-terra-500"
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
            <span className="ml-1 text-rose-600 dark:text-rose-400">
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
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm outline-none focus:border-terra-500"
            />

            <span className="mt-2 block text-xs text-muted">
              Dakika olarak girin. Örneğin birebir piyano için 50.
            </span>
          </label>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium">
              Varsayılan aylık ücret
              <span className="ml-1 text-rose-600 dark:text-rose-400">
                *
              </span>

              <div className="mt-2 flex rounded-xl border border-line bg-panel focus-within:border-terra-500">
                <span className="grid place-items-center border-r border-line px-4 text-sm font-semibold text-muted">
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

              <span className="mt-2 block text-xs text-muted">
                4400 veya 4400,00 biçiminde girin. Binlik ayırıcı kullanmayın.
              </span>
            </label>
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link
          href="/dersler"
          className="rounded-xl border border-line bg-panel px-5 py-3 text-center text-sm font-semibold text-brand-700"
        >
          Vazgeç
        </Link>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
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