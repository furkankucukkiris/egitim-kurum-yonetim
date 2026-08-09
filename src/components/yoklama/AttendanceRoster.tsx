"use client";

import { useState, useTransition } from "react";
import {
  lockSessionAttendance,
  markAttendance,
  unlockSessionAttendance,
  type AttendanceEntry,
} from "@/app/(dashboard)/yoklama/attendance-actions";

export type AttendanceStatus = AttendanceEntry["status"];

export type RosterStudent = {
  studentId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus | null;
  note: string | null;
  notifiedAt: string | null;
};

const STATUS_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: "present",
    label: "Geldi",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  {
    value: "absent",
    label: "Gelmedi",
    badgeClass: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-400",
  },
  {
    value: "excused",
    label: "Mazeretli",
    badgeClass: "bg-honey-100 text-honey-700 dark:bg-honey-500/15 dark:text-honey-500",
  },
  {
    value: "makeup_due",
    label: "Telafi hakkı doğdu",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400",
  },
  {
    value: "makeup_completed",
    label: "Telafi tamamlandı",
    badgeClass: "bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-100",
  },
  {
    value: "institution_cancelled",
    label: "Kurum kaynaklı iptal",
    badgeClass: "bg-fill text-muted",
  },
];

const statusLabel = (status: AttendanceStatus | null) =>
  STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "İşaretlenmedi";

const statusBadgeClass = (status: AttendanceStatus | null) =>
  STATUS_OPTIONS.find((option) => option.value === status)?.badgeClass ?? "bg-fill text-muted";

type DraftState = Record<
  string,
  { status: AttendanceStatus; note: string; notifyGuardian: boolean }
>;

export function AttendanceRoster({
  sessionId,
  date,
  students,
  locked,
  lockedByName,
  canMark,
  isAdmin,
}: {
  sessionId: string;
  date: string;
  students: RosterStudent[];
  locked: boolean;
  lockedByName: string | null;
  canMark: boolean;
  isAdmin: boolean;
}) {
  const [draft, setDraft] = useState<DraftState>(() => buildInitialDraft(students));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();
  const [unlockOpen, setUnlockOpen] = useState(false);

  if (students.length === 0) {
    return (
      <p className="mt-4 rounded-xl border border-dashed border-line bg-fill p-4 text-center text-sm text-muted">
        Bu oturum tarihinde programa aktif kayıtlı öğrenci bulunmuyor.
      </p>
    );
  }

  function setStatus(studentId: string, status: AttendanceStatus) {
    setDraft((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], status },
    }));
  }

  function setNote(studentId: string, note: string) {
    setDraft((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], note },
    }));
  }

  function setNotify(studentId: string, notifyGuardian: boolean) {
    setDraft((prev) => ({
      ...prev,
      [studentId]: { ...prev[studentId], notifyGuardian },
    }));
  }

  function markAllPresent() {
    setDraft((prev) => {
      const next: DraftState = { ...prev };

      for (const student of students) {
        next[student.studentId] = {
          ...next[student.studentId],
          status: "present",
        };
      }

      return next;
    });
  }

  function handleSave() {
    const entries: AttendanceEntry[] = students.map((student) => {
      const entry = draft[student.studentId];

      return {
        student_id: student.studentId,
        status: entry.status,
        note: entry.note || undefined,
        notify_guardian: entry.notifyGuardian,
      };
    });

    const formData = new FormData();
    formData.set("lessonSessionId", sessionId);
    formData.set("date", date);
    formData.set("entries", JSON.stringify(entries));

    startTransition(() => {
      markAttendance(formData);
    });
  }

  if (locked) {
    return (
      <div className="mt-4 border-t border-line pt-4">
        <div className="mb-3 rounded-xl border border-honey-100 bg-honey-50 p-3 text-sm text-honey-700 dark:border-honey-800/40 dark:bg-honey-500/10 dark:text-honey-500">
          Bu oturumun yoklaması kilitlendi
          {lockedByName ? ` (${lockedByName})` : ""}. Değişiklik için
          yöneticinin kilidi gerekçeyle açması gerekir.
        </div>

        <ul className="space-y-2">
          {students.map((student) => (
            <li
              key={student.studentId}
              className="flex items-center justify-between gap-3 rounded-xl bg-fill px-3 py-2 text-sm"
            >
              <span className="font-medium text-ink">
                {student.firstName} {student.lastName}
              </span>

              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadgeClass(student.status)}`}
              >
                {statusLabel(student.status)}
              </span>
            </li>
          ))}
        </ul>

        {isAdmin && (
          <div className="mt-3">
            {unlockOpen ? (
              <form
                action={unlockSessionAttendance}
                className="flex flex-col gap-2 rounded-xl border border-line bg-panel p-3"
              >
                <input type="hidden" name="lessonSessionId" value={sessionId} />
                <input type="hidden" name="date" value={date} />

                <label className="text-xs font-medium text-muted">
                  Kilidi açma gerekçesi

                  <input
                    name="reason"
                    required
                    minLength={3}
                    placeholder="ör. öğretmen hatalı işaretlemiş"
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-terra-500"
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-terra-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-terra-700/20 hover:bg-terra-700/90"
                  >
                    Kilidi aç
                  </button>

                  <button
                    type="button"
                    onClick={() => setUnlockOpen(false)}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted"
                  >
                    Vazgeç
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setUnlockOpen(true)}
                className="text-xs font-semibold text-brand-700 underline underline-offset-4 dark:text-brand-100"
              >
                Kilidi gerekçeyle aç
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">
          Yoklama — varsayılan durum “Geldi”, istisnaları işaretleyin
        </p>

        {canMark && (
          <button
            type="button"
            onClick={markAllPresent}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-fill dark:text-brand-100"
          >
            Tümünü geldi işaretle
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {students.map((student) => {
          const entry = draft[student.studentId];
          const isOpen = Boolean(expanded[student.studentId]);

          return (
            <li
              key={student.studentId}
              className="rounded-xl border border-line bg-panel p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink">
                  {student.firstName} {student.lastName}
                </span>

                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${statusBadgeClass(entry.status)}`}
                >
                  {statusLabel(entry.status)}
                </span>
              </div>

              {canMark && (
                <>
                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setStatus(student.studentId, "present")}
                      className={`rounded-lg py-3 text-sm font-semibold transition ${
                        entry.status === "present"
                          ? "bg-emerald-600 text-white"
                          : "bg-fill text-ink hover:bg-emerald-100 dark:hover:bg-emerald-500/15"
                      }`}
                    >
                      Geldi
                    </button>

                    <button
                      type="button"
                      onClick={() => setStatus(student.studentId, "absent")}
                      className={`rounded-lg py-3 text-sm font-semibold transition ${
                        entry.status === "absent"
                          ? "bg-rose-600 text-white"
                          : "bg-fill text-ink hover:bg-rose-100 dark:hover:bg-rose-500/15"
                      }`}
                    >
                      Gelmedi
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({
                        ...prev,
                        [student.studentId]: !prev[student.studentId],
                      }))
                    }
                    className="mt-2 text-xs font-semibold text-brand-700 underline underline-offset-4 dark:text-brand-100"
                  >
                    {isOpen ? "Diğer seçenekleri gizle" : "Diğer durum / not / veli bildirimi"}
                  </button>

                  {isOpen && (
                    <div className="mt-2.5 space-y-2.5 rounded-lg bg-fill p-2.5">
                      <label className="block text-xs font-medium text-muted">
                        Durum

                        <select
                          value={entry.status}
                          onChange={(event) =>
                            setStatus(
                              student.studentId,
                              event.target.value as AttendanceStatus,
                            )
                          }
                          className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
                        >
                          {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs font-medium text-muted">
                        Not (özel bilgi yazmayın)

                        <textarea
                          value={entry.note}
                          onChange={(event) =>
                            setNote(student.studentId, event.target.value)
                          }
                          rows={2}
                          maxLength={500}
                          className="mt-1 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-terra-500"
                        />
                      </label>

                      <label className="flex items-center gap-2 text-xs font-medium text-muted">
                        <input
                          type="checkbox"
                          checked={entry.notifyGuardian}
                          onChange={(event) =>
                            setNotify(student.studentId, event.target.checked)
                          }
                          className="h-4 w-4 rounded border-line"
                        />
                        Veliye haber verildi
                      </label>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      {canMark && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className="rounded-xl bg-terra-700 px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90 disabled:opacity-60"
          >
            {isPending ? "Kaydediliyor…" : "Yoklamayı kaydet"}
          </button>

          {isAdmin && (
            <form action={lockSessionAttendance}>
              <input type="hidden" name="lessonSessionId" value={sessionId} />
              <input type="hidden" name="date" value={date} />

              <button
                type="submit"
                className="rounded-xl border border-line px-4 py-3 text-sm font-semibold text-muted hover:bg-fill"
              >
                Yoklamayı kilitle
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function buildInitialDraft(students: RosterStudent[]): DraftState {
  const draft: DraftState = {};

  for (const student of students) {
    draft[student.studentId] = {
      status: student.status ?? "present",
      note: student.note ?? "",
      notifyGuardian: Boolean(student.notifiedAt),
    };
  }

  return draft;
}
