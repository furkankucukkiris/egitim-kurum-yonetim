"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { createClassGroup, updateClassGroup } from "./actions";

type ActionState = {
  error: string | null;
};

const initialState: ActionState = {
  error: null,
};

type CourseOption = {
  id: string;
  name: string;
  courseType: "individual" | "group";
  defaultDurationMinutes: number;
};

type TeacherOption = {
  id: string;
  fullName: string;
};

type ClassGroupFormProps = {
  mode: "create" | "edit";

  courses: CourseOption[];
  teachers: TeacherOption[];

  group?: {
    id: string;
    courseId: string;
    courseName: string;
    courseType: "individual" | "group";
    name: string;
    teacherProfileId: string;
    roomName: string;
    capacity: number;
    weekday: number;
    startTime: string;
    durationMinutes: number;
    startsOn: string;
    endsOn: string;
  };
};

export function ClassGroupForm({ mode, courses, teachers, group }: ClassGroupFormProps) {
  const action = mode === "create" ? createClassGroup : updateClassGroup;

  const [state, formAction, isPending] = useActionState(action, initialState);

  const [values, setValues] = useState({
    courseId: group?.courseId ?? courses[0]?.id ?? "",

    name: group?.name ?? "",

    teacherProfileId: group?.teacherProfileId ?? "",

    roomName: group?.roomName ?? "",

    capacity: String(group?.capacity ?? 10),

    weekday: String(group?.weekday ?? 6),

    startTime: group?.startTime ?? "11:00",

    durationMinutes: String(group?.durationMinutes ?? courses[0]?.defaultDurationMinutes ?? 60),

    startsOn: group?.startsOn ?? getTodayInIstanbul(),

    endsOn: group?.endsOn ?? "",
  });

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === values.courseId),
    [courses, values.courseId],
  );

  const isIndividual =
    mode === "edit"
      ? group?.courseType === "individual"
      : selectedCourse?.courseType === "individual";

  function updateValue(field: keyof typeof values, value: string) {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function changeCourse(courseId: string) {
    const course = courses.find((item) => item.id === courseId);

    setValues((current) => ({
      ...current,
      courseId,
      capacity:
        course?.courseType === "individual"
          ? "1"
          : current.capacity === "1"
            ? "10"
            : current.capacity,

      durationMinutes: String(course?.defaultDurationMinutes ?? current.durationMinutes),
    }));
  }

  return (
    <form action={formAction} className="mx-auto max-w-4xl space-y-6">
      {mode === "edit" && group && <input type="hidden" name="groupId" value={group.id} />}

      {state.error && (
        <div
          role="alert"
          className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger"
        >
          {state.error}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-bold">Ders ve seans bilgileri</h2>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {mode === "create" ? (
            <label className="block text-sm font-medium md:col-span-2">
              Ders
              <span className="ml-1 text-danger text-danger">*</span>
              <select
                name="courseId"
                required
                value={values.courseId}
                onChange={(event) => changeCourse(event.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name} — {course.courseType === "individual" ? "Birebir" : "Grup"}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <input type="hidden" name="courseId" value={group?.courseId} />

              <div className="rounded-xl bg-surface-muted p-4 md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  Ders
                </p>

                <p className="mt-1 font-bold">{group?.courseName}</p>
              </div>
            </>
          )}

          <Field
            label="Seans adı"
            name="name"
            required
            value={values.name}
            placeholder={isIndividual ? "Örneğin: Cuma 18.00" : "Örneğin: Cumartesi 11.00 Grubu"}
            onChange={(value) => updateValue("name", value)}
          />

          <label className="block text-sm font-medium">
            Öğretmen
            <select
              name="teacherProfileId"
              value={values.teacherProfileId}
              onChange={(event) => updateValue("teacherProfileId", event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            >
              <option value="">Daha sonra atanacak</option>

              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          </label>

          <Field
            label="Derslik / oda"
            name="roomName"
            value={values.roomName}
            placeholder="Örneğin: Resim Atölyesi"
            onChange={(value) => updateValue("roomName", value)}
          />

          <Field
            label="Kapasite"
            name="capacity"
            type="number"
            required
            min={1}
            max={100}
            readOnly={Boolean(isIndividual)}
            value={isIndividual ? "1" : values.capacity}
            helperText={
              isIndividual
                ? "Birebir derslerde kapasite otomatik olarak 1'dir."
                : "Bu seansa kaydedilebilecek azami öğrenci sayısı."
            }
            onChange={(value) => updateValue("capacity", value)}
          />

          <label className="block text-sm font-medium">
            Ders günü
            <span className="ml-1 text-danger text-danger">*</span>
            <select
              name="weekday"
              value={values.weekday}
              onChange={(event) => updateValue("weekday", event.target.value)}
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            >
              <option value="1">Pazartesi</option>
              <option value="2">Salı</option>
              <option value="3">Çarşamba</option>
              <option value="4">Perşembe</option>
              <option value="5">Cuma</option>
              <option value="6">Cumartesi</option>
              <option value="7">Pazar</option>
            </select>
          </label>

          <Field
            label="Başlangıç saati"
            name="startTime"
            type="time"
            required
            value={values.startTime}
            onChange={(value) => updateValue("startTime", value)}
          />

          <Field
            label="Ders süresi"
            name="durationMinutes"
            type="number"
            required
            min={15}
            max={480}
            step={5}
            value={values.durationMinutes}
            helperText="Dakika olarak girin."
            onChange={(value) => updateValue("durationMinutes", value)}
          />

          <div className="hidden md:block" />

          <Field
            label="Program başlangıç tarihi"
            name="startsOn"
            type="date"
            required
            value={values.startsOn}
            onChange={(value) => updateValue("startsOn", value)}
          />

          <Field
            label="Program bitiş tarihi"
            name="endsOn"
            type="date"
            value={values.endsOn}
            helperText="Süresiz devam edecekse boş bırakın."
            onChange={(value) => updateValue("endsOn", value)}
          />
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link
          href="/program"
          className="rounded-xl border border-border bg-surface px-5 py-3 text-center text-sm font-semibold text-primary"
        >
          Vazgeç
        </Link>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
        >
          {isPending
            ? "Kaydediliyor..."
            : mode === "create"
              ? "Seansı oluştur"
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
  placeholder?: string;
  helperText?: string;
  readOnly?: boolean;

  min?: number;
  max?: number;
  step?: number;
};

function Field({
  label,
  name,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
  helperText,
  readOnly = false,
  min,
  max,
  step,
}: FieldProps) {
  return (
    <label className="block text-sm font-medium">
      {label}

      {required && <span className="ml-1 text-danger text-danger">*</span>}

      <input
        name={name}
        type={type}
        required={required}
        value={value}
        readOnly={readOnly}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-primary read-only:bg-surface-muted"
      />

      {helperText && (
        <span className="mt-2 block text-xs leading-5 text-text-secondary">{helperText}</span>
      )}
    </label>
  );
}

function getTodayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
