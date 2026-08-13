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
  isMakeupGuest: boolean;
};

const STATUS_OPTIONS: {
  value: AttendanceStatus;
  label: string;
  badgeClass: string;
}[] = [
  {
    value: "present",
    label: "Geldi",
    badgeClass: "bg-success-soft text-success bg-success-soft text-success",
  },
  {
    value: "absent",
    label: "Gelmedi",
    badgeClass: "bg-danger-soft text-danger bg-danger-soft text-danger",
  },
  {
    value: "excused",
    label: "Mazeretli",
    badgeClass: "bg-accent-soft text-accent-strong bg-accent-soft",
  },
  {
    value: "makeup_due",
    label: "Telafi hakkı doğdu",
    badgeClass: "bg-info-soft text-info bg-info-soft text-info",
  },
  {
    value: "makeup_completed",
    label: "Telafi tamamlandı",
    badgeClass: "bg-primary-soft text-primary bg-primary-soft/15 text-primary",
  },
  {
    value: "institution_cancelled",
    label: "Kurum kaynaklı iptal",
    badgeClass: "bg-surface-muted text-text-secondary",
  },
];

const statusLabel = (status: AttendanceStatus | null) =>
  STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "İşaretlenmedi";

const statusBadgeClass = (status: AttendanceStatus | null) =>
  STATUS_OPTIONS.find((option) => option.value === status)?.badgeClass ??
  "bg-surface-muted text-text-secondary";

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
      <p className="mt-4 rounded-xl border border-dashed border-border bg-surface-muted p-4 text-center text-sm text-text-secondary">
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
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-3 rounded-xl border border-accent/30 bg-accent-soft p-3 text-sm text-accent-strong border-accent/40 bg-accent-soft">
          Bu oturumun yoklaması kilitlendi
          {lockedByName ? ` (${lockedByName})` : ""}. Değişiklik için yöneticinin kilidi gerekçeyle
          açması gerekir.
        </div>

        <ul className="space-y-2">
          {students.map((student) => (
            <li
              key={student.studentId}
              className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2 text-sm"
            >
              <span className="font-medium text-text-primary">
                {student.firstName} {student.lastName}
                {student.isMakeupGuest && <MakeupBadge />}
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
                className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
              >
                <input type="hidden" name="lessonSessionId" value={sessionId} />
                <input type="hidden" name="date" value={date} />

                <label className="text-xs font-medium text-text-secondary">
                  Kilidi açma gerekçesi
                  <input
                    name="reason"
                    required
                    minLength={3}
                    placeholder="ör. öğretmen hatalı işaretlemiş"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary"
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-hover"
                  >
                    Kilidi aç
                  </button>

                  <button
                    type="button"
                    onClick={() => setUnlockOpen(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary"
                  >
                    Vazgeç
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setUnlockOpen(true)}
                className="text-xs font-semibold text-primary underline underline-offset-4 text-primary"
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
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-text-primary">
          Yoklama — varsayılan durum “Geldi”, istisnaları işaretleyin
        </p>

        {canMark && (
          <button
            type="button"
            onClick={markAllPresent}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-surface-muted text-primary"
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
            <li key={student.studentId} className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-text-primary">
                  {student.firstName} {student.lastName}
                  {student.isMakeupGuest && <MakeupBadge />}
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
                          ? "bg-success text-on-primary"
                          : "bg-surface-muted text-text-primary hover:bg-success-soft dark:hover:bg-success-soft/15"
                      }`}
                    >
                      Geldi
                    </button>

                    <button
                      type="button"
                      onClick={() => setStatus(student.studentId, "absent")}
                      className={`rounded-lg py-3 text-sm font-semibold transition ${
                        entry.status === "absent"
                          ? "bg-danger text-on-primary"
                          : "bg-surface-muted text-text-primary hover:bg-danger-soft dark:hover:bg-danger-soft/15"
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
                    className="mt-2 text-xs font-semibold text-primary underline underline-offset-4 text-primary"
                  >
                    {isOpen ? "Diğer seçenekleri gizle" : "Diğer durum / not / veli bildirimi"}
                  </button>

                  {isOpen && (
                    <div className="mt-2.5 space-y-2.5 rounded-lg bg-surface-muted p-2.5">
                      <label className="block text-xs font-medium text-text-secondary">
                        Durum
                        <select
                          value={entry.status}
                          onChange={(event) =>
                            setStatus(student.studentId, event.target.value as AttendanceStatus)
                          }
                          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                        >
                          {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs font-medium text-text-secondary">
                        Not (özel bilgi yazmayın)
                        <textarea
                          value={entry.note}
                          onChange={(event) => setNote(student.studentId, event.target.value)}
                          rows={2}
                          maxLength={500}
                          className="mt-1 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </label>

                      <label className="flex items-center gap-2 text-xs font-medium text-text-secondary">
                        <input
                          type="checkbox"
                          checked={entry.notifyGuardian}
                          onChange={(event) => setNotify(student.studentId, event.target.checked)}
                          className="h-4 w-4 rounded border-border"
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
            className="rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
          >
            {isPending ? "Kaydediliyor…" : "Yoklamayı kaydet"}
          </button>

          {isAdmin && (
            <form action={lockSessionAttendance}>
              <input type="hidden" name="lessonSessionId" value={sessionId} />
              <input type="hidden" name="date" value={date} />

              <button
                type="submit"
                className="rounded-xl border border-border px-4 py-3 text-sm font-semibold text-text-secondary hover:bg-surface-muted"
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

function MakeupBadge() {
  return (
    <span className="ml-2 rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-info bg-info-soft text-info">
      Telafi
    </span>
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
