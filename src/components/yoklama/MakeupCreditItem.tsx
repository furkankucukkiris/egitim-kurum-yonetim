"use client";

import { useState } from "react";
import {
  cancelMakeupCredit,
  scheduleMakeupIntoSession,
  scheduleMakeupNewSession,
} from "@/app/(dashboard)/yoklama/session-actions";

export type PendingCredit = {
  creditId: string;
  studentFullName: string;
  courseId: string;
  courseName: string;
  reason: "institution_cancelled" | "student_absence";
  sourceStartsAt: string;
  expiresAt: string | null;
};

export type UpcomingSessionOption = {
  id: string;
  startsAt: string;
  className: string | null;
  teacherName: string | null;
};

export type TeacherOption = {
  id: string;
  fullName: string;
};

const reasonLabels: Record<PendingCredit["reason"], string> = {
  institution_cancelled: "Kurum kaynaklı iptal",
  student_absence: "Öğrenci kaynaklı devamsızlık",
};

type Mode = "existing" | "new" | "cancel" | null;

export function MakeupCreditItem({
  credit,
  date,
  sessionsForCourse,
  teachers,
}: {
  credit: PendingCredit;
  date: string;
  sessionsForCourse: UpcomingSessionOption[];
  teachers: TeacherOption[];
}) {
  const [mode, setMode] = useState<Mode>(null);

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-text-primary">
            {credit.studentFullName}
            <span className="ml-2 text-xs font-normal text-text-secondary">
              {credit.courseName}
            </span>
          </p>

          <p className="mt-0.5 text-xs text-text-secondary">
            {reasonLabels[credit.reason]} · {formatDate(credit.sourceStartsAt)}
            {credit.expiresAt ? ` · son geçerlilik ${formatDate(credit.expiresAt)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ToggleButton
            active={mode === "existing"}
            onClick={() => setMode(mode === "existing" ? null : "existing")}
            label="Mevcut oturuma ekle"
          />
          <ToggleButton
            active={mode === "new"}
            onClick={() => setMode(mode === "new" ? null : "new")}
            label="Yeni oturum oluştur"
          />
          <ToggleButton
            active={mode === "cancel"}
            onClick={() => setMode(mode === "cancel" ? null : "cancel")}
            label="Hakkı iptal et"
          />
        </div>
      </div>

      {mode === "existing" && (
        <form
          action={scheduleMakeupIntoSession}
          className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-muted p-3 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="creditId" value={credit.creditId} />
          <input type="hidden" name="date" value={date} />

          <label className="flex-1 text-xs font-medium text-text-secondary">
            Hedef oturum
            <select
              name="targetLessonSessionId"
              required
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            >
              {sessionsForCourse.length === 0 && (
                <option value="" disabled>
                  Bu ders için yaklaşan uygun oturum yok
                </option>
              )}

              {sessionsForCourse.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatDateTime(session.startsAt)} — {session.className ?? "Program belirtilmedi"}{" "}
                  ({session.teacherName ?? "Atanmamış"})
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            disabled={sessionsForCourse.length === 0}
            className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-hover disabled:opacity-50"
          >
            Ekle
          </button>
        </form>
      )}

      {mode === "new" && (
        <form
          action={scheduleMakeupNewSession}
          className="mt-3 grid gap-2 rounded-lg bg-surface-muted p-3 sm:grid-cols-2"
        >
          <input type="hidden" name="creditId" value={credit.creditId} />
          <input type="hidden" name="date" value={date} />

          <label className="text-xs font-medium text-text-secondary sm:col-span-2">
            Öğretmen
            <select
              name="teacherProfileId"
              required
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">Seçiniz</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-text-secondary sm:col-span-2">
            Derslik (opsiyonel)
            <input
              name="roomName"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="text-xs font-medium text-text-secondary">
            Tarih
            <input
              type="date"
              name="newDate"
              required
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-text-secondary">
              Başlangıç
              <input
                type="time"
                name="newStartTime"
                required
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Bitiş
              <input
                type="time"
                name="newEndTime"
                required
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>

          <button
            type="submit"
            className="self-end rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-hover sm:col-span-2 sm:w-fit sm:justify-self-end"
          >
            Telafi oturumu oluştur
          </button>
        </form>
      )}

      {mode === "cancel" && (
        <form
          action={cancelMakeupCredit}
          className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-muted p-3 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="creditId" value={credit.creditId} />
          <input type="hidden" name="date" value={date} />

          <label className="flex-1 text-xs font-medium text-text-secondary">
            İptal gerekçesi
            <input
              name="reason"
              required
              minLength={3}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <button
            type="submit"
            className="rounded-lg bg-danger px-3 py-2 text-xs font-semibold text-on-primary hover:bg-danger/90"
          >
            Hakkı iptal et
          </button>
        </form>
      )}
    </li>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-primary-soft bg-primary-soft text-primary dark:bg-primary/10"
          : "border-border text-text-secondary hover:bg-surface-muted"
      }`}
    >
      {label}
    </button>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
