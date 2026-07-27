"use client";

import {
  useActionState,
  useMemo,
  useState,
} from "react";

import {
  createEnrollment,
  updateEnrollmentMeb,
} from "./enrollment-actions";

type CourseOption = {
  id: string;
  name: string;
  defaultMonthlyFee: number;
  mebStatus: string;
};

type GroupOption = {
  id: string;
  courseId: string;
  name: string;
  capacity: number;
  studentCount: number;
  weekday: number;
  startTime: string;
  teacherName: string;
};

type EnrollmentItem = {
  id: string;
  courseName: string;
  groupName: string;
  teacherName: string;
  weekday: number | null;
  startTime: string;
  startsOn: string;
  endsOn: string;
  status: string;

  listMonthlyFee: number;
  discountType: string;
  discountValue: number;
  netMonthlyFee: number;
  dueDay: number;
  notes: string;

  mebStatus: string;
  mebRegistrationNumber: string;
  mebValidFrom: string;
  mebValidUntil: string;
  mebNonRegistrationReason: string;
  mebNote: string;
};

type Props = {
  studentId: string;
  isArchived: boolean;
  courses: CourseOption[];
  groups: GroupOption[];
  enrollments: EnrollmentItem[];
};

type ActionState = {
  error: string | null;
};

const initialState: ActionState = {
  error: null,
};

const weekdayLabels: Record<
  number,
  string
> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

const mebStatusOptions = [
  ["registered", "MEB kayıtlı"],
  ["pending", "MEB kayıt işlemi bekliyor"],
  [
    "not_registered",
    "MEB kayıtlı değil",
  ],
  [
    "not_eligible",
    "MEB kaydı yapılamıyor",
  ],
  ["rejected", "MEB kaydı reddedildi"],
  ["ended", "MEB kaydı sona erdi"],
  ["unchecked", "Kontrol edilmedi"],
] as const;

export function StudentEnrollmentManagement({
  studentId,
  isArchived,
  courses,
  groups,
  enrollments,
}: Props) {
  const [formOpen, setFormOpen] =
    useState(false);

  const [
    state,
    formAction,
    isPending,
  ] = useActionState(
    createEnrollment,
    initialState,
  );

  const firstCourse =
    courses[0] ?? null;

  const firstGroup =
    groups.find(
      (group) =>
        group.courseId ===
        firstCourse?.id,
    ) ?? null;

  const [values, setValues] = useState({
    courseId:
      firstCourse?.id ?? "",

    classGroupId:
      firstGroup?.id ?? "",

    startsOn:
      getTodayInIstanbul(),

    endsOn: "",

    listMonthlyFee: String(
      firstCourse
        ?.defaultMonthlyFee ?? "",
    ),

    discountType: "none",
    discountValue: "0",
    dueDay: "1",
    notes: "",

    mebStatus: "unchecked",

    mebRegistrationNumber: "",
    mebValidFrom: "",
    mebValidUntil: "",

    mebNonRegistrationReason: "",
    mebNote: "",
  });

  const availableGroups =
    useMemo(
      () =>
        groups.filter(
          (group) =>
            group.courseId ===
            values.courseId,
        ),
      [groups, values.courseId],
    );

  const selectedCourse =
    courses.find(
      (course) =>
        course.id === values.courseId,
    );

  const netMonthlyFee =
    calculateNetFee(
      values.listMonthlyFee,
      values.discountType,
      values.discountValue,
    );

  const reasonRequired = [
    "not_registered",
    "not_eligible",
    "rejected",
  ].includes(values.mebStatus);

  function updateValue(
    field: keyof typeof values,
    value: string,
  ) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function changeCourse(
    courseId: string,
  ) {
    const course = courses.find(
      (item) =>
        item.id === courseId,
    );

    const firstCourseGroup =
      groups.find(
        (group) =>
          group.courseId ===
          courseId,
      );

    setValues((current) => ({
      ...current,

      courseId,

      classGroupId:
        firstCourseGroup?.id ?? "",

      listMonthlyFee: String(
        course?.defaultMonthlyFee ??
        "",
      ),
    }));
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold">
            Ders kayıtları
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Öğrencinin ders, seans, ücret ve MEB kayıt durumlarını yönetin.
          </p>
        </div>

        {!isArchived &&
          courses.length > 0 && (
            <button
              type="button"
              onClick={() =>
                setFormOpen(
                  (current) =>
                    !current,
                )
              }
              className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white"
            >
              {formOpen
                ? "Formu kapat"
                : "+ Derse kaydet"}
            </button>
          )}
      </div>

      {enrollments.length === 0 ? (
        <div className="mt-5 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
          Öğrencinin henüz bir ders kaydı bulunmuyor.
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {enrollments.map(
            (enrollment) => (
              <article
                key={enrollment.id}
                className="rounded-2xl border border-slate-200 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">
                      {
                        enrollment.courseName
                      }
                    </h3>

                    <p className="mt-1 text-sm text-slate-500">
                      {
                        enrollment.groupName
                      }
                    </p>
                  </div>

                  <EnrollmentStatusBadge
                    status={
                      enrollment.status
                    }
                  />
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                  <Info
                    label="Öğretmen"
                    value={
                      enrollment.teacherName
                    }
                  />

                  <Info
                    label="Program"
                    value={
                      enrollment.weekday
                        ? `${
                            weekdayLabels[
                              enrollment
                                .weekday
                            ]
                          } ${
                            enrollment.startTime
                          }`
                        : "Belirtilmedi"
                    }
                  />

                  <Info
                    label="Başlangıç"
                    value={formatDate(
                      enrollment.startsOn,
                    )}
                  />

                  <Info
                    label="Ödeme günü"
                    value={`Her ayın ${enrollment.dueDay}. günü`}
                  />

                  <Info
                    label="Liste ücreti"
                    value={formatMoney(
                      enrollment.listMonthlyFee,
                    )}
                  />

                  <Info
                    label="Net aylık ücret"
                    value={formatMoney(
                      enrollment.netMonthlyFee,
                    )}
                    emphasized
                  />
                </dl>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <MebBadge
                      status={
                        enrollment.mebStatus
                      }
                    />

                    {enrollment
                      .mebNonRegistrationReason && (
                      <span className="text-xs text-rose-700">
                        {
                          enrollment
                            .mebNonRegistrationReason
                        }
                      </span>
                    )}
                  </div>

                  <details className="mt-4 rounded-xl bg-slate-50">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                      MEB kaydını güncelle
                    </summary>

                    <form
                      action={
                        updateEnrollmentMeb
                      }
                      className="grid gap-4 border-t border-slate-200 p-4 md:grid-cols-2"
                    >
                      <input
                        type="hidden"
                        name="studentId"
                        value={studentId}
                      />

                      <input
                        type="hidden"
                        name="enrollmentId"
                        value={
                          enrollment.id
                        }
                      />

                      <SelectMebStatus
                        defaultValue={
                          enrollment.mebStatus
                        }
                      />

                      <Field
                        label="MEB kayıt numarası"
                        name="mebRegistrationNumber"
                        defaultValue={
                          enrollment
                            .mebRegistrationNumber
                        }
                      />

                      <Field
                        label="MEB başlangıç tarihi"
                        name="mebValidFrom"
                        type="date"
                        defaultValue={
                          enrollment
                            .mebValidFrom
                        }
                      />

                      <Field
                        label="MEB bitiş tarihi"
                        name="mebValidUntil"
                        type="date"
                        defaultValue={
                          enrollment
                            .mebValidUntil
                        }
                      />

                      <div className="md:col-span-2">
                        <Field
                          label="Kayıt yapılamama nedeni"
                          name="mebNonRegistrationReason"
                          defaultValue={
                            enrollment
                              .mebNonRegistrationReason
                          }
                        />
                      </div>

                      <div className="md:col-span-2">
                        <Field
                          label="MEB açıklaması"
                          name="mebNote"
                          defaultValue={
                            enrollment
                              .mebNote
                          }
                        />
                      </div>

                      <div className="md:col-span-2 flex justify-end">
                        <button
                          type="submit"
                          className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white"
                        >
                          MEB durumunu kaydet
                        </button>
                      </div>
                    </form>
                  </details>
                </div>
              </article>
            ),
          )}
        </div>
      )}

      {formOpen && !isArchived && (
        <form
          action={formAction}
          className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5"
        >
          <input
            type="hidden"
            name="studentId"
            value={studentId}
          />

          <h3 className="font-bold">
            Yeni ders kaydı
          </h3>

          {state.error && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {state.error}
            </div>
          )}

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Ders
              <span className="ml-1 text-rose-600">
                *
              </span>

              <select
                name="courseId"
                required
                value={values.courseId}
                onChange={(event) =>
                  changeCourse(
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                {courses.map(
                  (course) => (
                    <option
                      key={course.id}
                      value={course.id}
                    >
                      {course.name}
                    </option>
                  ),
                )}
              </select>

              {selectedCourse && (
                <span className="mt-2 block text-xs text-slate-500">
                  Dersin genel MEB durumu:{" "}
                  {translateCourseMebStatus(
                    selectedCourse.mebStatus,
                  )}
                </span>
              )}
            </label>

            <label className="block text-sm font-medium">
              Ders seansı
              <span className="ml-1 text-rose-600">
                *
              </span>

              <select
                name="classGroupId"
                required
                value={
                  values.classGroupId
                }
                onChange={(event) =>
                  updateValue(
                    "classGroupId",
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <option value="">
                  Seans seçin
                </option>

                {availableGroups.map(
                  (group) => (
                    <option
                      key={group.id}
                      value={group.id}
                      disabled={
                        group.studentCount >=
                        group.capacity
                      }
                    >
                      {group.name} —{" "}
                      {
                        weekdayLabels[
                          group.weekday
                        ]
                      }{" "}
                      {group.startTime} —{" "}
                      {group.studentCount}/
                      {group.capacity}
                    </option>
                  ),
                )}
              </select>
            </label>

            <ControlledField
              label="Ders başlangıç tarihi"
              name="startsOn"
              type="date"
              required
              value={values.startsOn}
              onChange={(value) =>
                updateValue(
                  "startsOn",
                  value,
                )
              }
            />

            <ControlledField
              label="Ders bitiş tarihi"
              name="endsOn"
              type="date"
              value={values.endsOn}
              helperText="Süresiz devam edecekse boş bırakın."
              onChange={(value) =>
                updateValue(
                  "endsOn",
                  value,
                )
              }
            />

            <ControlledField
              label="Liste aylık ücreti"
              name="listMonthlyFee"
              required
              inputMode="decimal"
              value={
                values.listMonthlyFee
              }
              onChange={(value) =>
                updateValue(
                  "listMonthlyFee",
                  value,
                )
              }
            />

            <label className="block text-sm font-medium">
              İndirim türü

              <select
                name="discountType"
                value={
                  values.discountType
                }
                onChange={(event) =>
                  updateValue(
                    "discountType",
                    event.target.value,
                  )
                }
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
              >
                <option value="none">
                  İndirim yok
                </option>

                <option value="percent">
                  Yüzde indirim
                </option>

                <option value="fixed">
                  Sabit tutar indirimi
                </option>
              </select>
            </label>

            <ControlledField
              label={
                values.discountType ===
                "percent"
                  ? "İndirim yüzdesi"
                  : "İndirim tutarı"
              }
              name="discountValue"
              required
              inputMode="decimal"
              readOnly={
                values.discountType ===
                "none"
              }
              value={
                values.discountType ===
                "none"
                  ? "0"
                  : values.discountValue
              }
              onChange={(value) =>
                updateValue(
                  "discountValue",
                  value,
                )
              }
            />

            <ControlledField
              label="Aylık ödeme günü"
              name="dueDay"
              type="number"
              min={1}
              max={28}
              required
              value={values.dueDay}
              onChange={(value) =>
                updateValue(
                  "dueDay",
                  value,
                )
              }
            />

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-semibold uppercase text-emerald-700">
                Net aylık ücret
              </p>

              <p className="mt-1 text-xl font-bold text-emerald-900">
                {formatMoney(
                  netMonthlyFee,
                )}
              </p>
            </div>

            <div className="md:col-span-2">
              <ControlledField
                label="Ders kayıt notu"
                name="notes"
                value={values.notes}
                onChange={(value) =>
                  updateValue(
                    "notes",
                    value,
                  )
                }
              />
            </div>
          </div>

          <div className="mt-7 border-t border-slate-200 pt-6">
            <h4 className="font-bold">
              Öğrencinin bu dersteki MEB durumu
            </h4>

            <p className="mt-1 text-sm text-slate-500">
              Bu bilgi öğrencinin genel profiline değil, seçilen ders kaydına aittir.
            </p>

            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <label className="block text-sm font-medium">
                MEB kayıt durumu

                <select
                  name="mebStatus"
                  value={
                    values.mebStatus
                  }
                  onChange={(event) =>
                    updateValue(
                      "mebStatus",
                      event.target.value,
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
                >
                  {mebStatusOptions.map(
                    ([value, label]) => (
                      <option
                        key={value}
                        value={value}
                      >
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <ControlledField
                label="MEB kayıt numarası"
                name="mebRegistrationNumber"
                value={
                  values.mebRegistrationNumber
                }
                onChange={(value) =>
                  updateValue(
                    "mebRegistrationNumber",
                    value,
                  )
                }
              />

              <ControlledField
                label="MEB geçerlilik başlangıcı"
                name="mebValidFrom"
                type="date"
                value={
                  values.mebValidFrom
                }
                onChange={(value) =>
                  updateValue(
                    "mebValidFrom",
                    value,
                  )
                }
              />

              <ControlledField
                label="MEB geçerlilik bitişi"
                name="mebValidUntil"
                type="date"
                value={
                  values.mebValidUntil
                }
                onChange={(value) =>
                  updateValue(
                    "mebValidUntil",
                    value,
                  )
                }
              />

              <div className="md:col-span-2">
                <ControlledField
                  label="MEB kaydının yapılamama nedeni"
                  name="mebNonRegistrationReason"
                  required={
                    reasonRequired
                  }
                  value={
                    values.mebNonRegistrationReason
                  }
                  onChange={(value) =>
                    updateValue(
                      "mebNonRegistrationReason",
                      value,
                    )
                  }
                />
              </div>

              <div className="md:col-span-2">
                <ControlledField
                  label="MEB açıklaması"
                  name="mebNote"
                  value={
                    values.mebNote
                  }
                  onChange={(value) =>
                    updateValue(
                      "mebNote",
                      value,
                    )
                  }
                />
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isPending
                ? "Ders kaydı oluşturuluyor..."
                : "Öğrenciyi derse kaydet"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function ControlledField({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  inputMode,
  helperText,
  readOnly = false,
  min,
  max,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  inputMode?:
    | "text"
    | "decimal"
    | "numeric";
  helperText?: string;
  readOnly?: boolean;
  min?: number;
  max?: number;
}) {
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
        inputMode={inputMode}
        readOnly={readOnly}
        min={min}
        max={max}
        onChange={(event) =>
          onChange(
            event.target.value,
          )
        }
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm read-only:bg-slate-100"
      />

      {helperText && (
        <span className="mt-2 block text-xs text-slate-500">
          {helperText}
        </span>
      )}
    </label>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}

      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
      />
    </label>
  );
}

function SelectMebStatus({
  defaultValue,
}: {
  defaultValue: string;
}) {
  return (
    <label className="block text-sm font-medium">
      MEB kayıt durumu

      <select
        name="mebStatus"
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"
      >
        {mebStatusOptions.map(
          ([value, label]) => (
            <option
              key={value}
              value={value}
            >
              {label}
            </option>
          ),
        )}
      </select>
    </label>
  );
}

function Info({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div>
      <dt className="text-slate-500">
        {label}
      </dt>

      <dd
        className={`mt-1 ${
          emphasized
            ? "text-lg font-bold"
            : "font-semibold"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function EnrollmentStatusBadge({
  status,
}: {
  status: string;
}) {
  const label =
    status === "active"
      ? "Aktif"
      : status === "frozen"
        ? "Donduruldu"
        : status === "completed"
          ? "Tamamlandı"
          : "İptal edildi";

  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
      {label}
    </span>
  );
}

function MebBadge({
  status,
}: {
  status: string;
}) {
  if (status === "registered") {
    return (
      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
        Öğrenci MEB kayıtlı
      </span>
    );
  }

  if (
    status === "pending" ||
    status === "unchecked"
  ) {
    return (
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
        MEB kontrolü gerekli
      </span>
    );
  }

  return (
    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800">
      MEB defterine ekleme
    </span>
  );
}

function calculateNetFee(
  listValue: string,
  discountType: string,
  discountValue: string,
) {
  const list = parseInputNumber(
    listValue,
  );

  const discount =
    parseInputNumber(
      discountValue,
    );

  if (discountType === "percent") {
    return Math.max(
      0,
      list -
        (list * discount) / 100,
    );
  }

  if (discountType === "fixed") {
    return Math.max(
      0,
      list - discount,
    );
  }

  return list;
}

function parseInputNumber(
  value: string,
) {
  const number = Number(
    value.replace(",", "."),
  );

  return Number.isFinite(number)
    ? number
    : 0;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(
    "tr-TR",
    {
      style: "currency",
      currency: "TRY",
    },
  ).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(
    "tr-TR",
  ).format(
    new Date(
      `${value}T00:00:00.000Z`,
    ),
  );
}

function getTodayInIstanbul() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date());
}

function translateCourseMebStatus(
  status: string,
) {
  const labels: Record<
    string,
    string
  > = {
    approved: "MEB onaylı",
    pending: "Başvuru bekliyor",
    not_registered:
      "MEB kayıtlı değil",
    expired: "Süresi dolmuş",
    unchecked:
      "Kontrol edilmedi",
  };

  return labels[status] ?? status;
}