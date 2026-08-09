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
    <li className="rounded-xl border border-line bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">
            {credit.studentFullName}
            <span className="ml-2 text-xs font-normal text-muted">
              {credit.courseName}
            </span>
          </p>

          <p className="mt-0.5 text-xs text-muted">
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
          className="mt-3 flex flex-col gap-2 rounded-lg bg-fill p-3 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="creditId" value={credit.creditId} />
          <input type="hidden" name="date" value={date} />

          <label className="flex-1 text-xs font-medium text-muted">
            Hedef oturum

            <select
              name="targetLessonSessionId"
              required
              className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
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
            className="rounded-lg bg-terra-700 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-terra-700/20 hover:bg-terra-700/90 disabled:opacity-50"
          >
            Ekle
          </button>
        </form>
      )}

      {mode === "new" && (
        <form
          action={scheduleMakeupNewSession}
          className="mt-3 grid gap-2 rounded-lg bg-fill p-3 sm:grid-cols-2"
        >
          <input type="hidden" name="creditId" value={credit.creditId} />
          <input type="hidden" name="date" value={date} />

          <label className="text-xs font-medium text-muted sm:col-span-2">
            Öğretmen

            <select
              name="teacherProfileId"
              required
              className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
            >
              <option value="">Seçiniz</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.fullName}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-muted sm:col-span-2">
            Derslik (opsiyonel)

            <input
              name="roomName"
              className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
            />
          </label>

          <label className="text-xs font-medium text-muted">
            Tarih

            <input
              type="date"
              name="newDate"
              required
              className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-medium text-muted">
              Başlangıç

              <input
                type="time"
                name="newStartTime"
                required
                className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
              />
            </label>

            <label className="text-xs font-medium text-muted">
              Bitiş

              <input
                type="time"
                name="newEndTime"
                required
                className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
              />
            </label>
          </div>

          <button
            type="submit"
            className="self-end rounded-lg bg-terra-700 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-terra-700/20 hover:bg-terra-700/90 sm:col-span-2 sm:w-fit sm:justify-self-end"
          >
            Telafi oturumu oluştur
          </button>
        </form>
      )}

      {mode === "cancel" && (
        <form
          action={cancelMakeupCredit}
          className="mt-3 flex flex-col gap-2 rounded-lg bg-fill p-3 sm:flex-row sm:items-end"
        >
          <input type="hidden" name="creditId" value={credit.creditId} />
          <input type="hidden" name="date" value={date} />

          <label className="flex-1 text-xs font-medium text-muted">
            İptal gerekçesi

            <input
              name="reason"
              required
              minLength={3}
              className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
            />
          </label>

          <button
            type="submit"
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-600/90"
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
          ? "border-terra-500 bg-terra-50 text-terra-700 dark:bg-terra-500/10"
          : "border-line text-muted hover:bg-fill"
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
