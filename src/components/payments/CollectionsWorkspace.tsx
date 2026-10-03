"use client";

import { useMemo, useRef, useState } from "react";
import { formatTry } from "@/lib/utils";
import { recordPayment } from "@/app/(dashboard)/odemeler/actions";
import type { OpenAccrualItem } from "./CoursePaymentCard";

export type CollectibleCourse = {
  courseId: string;
  courseName: string;
  netMonthlyFee: number;
  /** Tüm açık dönemler, en eskiden yeniye — record_payment_for_course() sırası. */
  openAccruals: OpenAccrualItem[];
};

export type CollectibleStudent = {
  studentId: string;
  studentName: string;
  courses: CollectibleCourse[];
};

type Selection = { studentId: string; courseId: string };

const methodOptions = [
  ["cash", "Nakit"],
  ["bank_transfer", "Havale / EFT"],
  ["card", "Kart"],
  ["online", "Online"],
  ["other", "Diğer"],
] as const;

const inputClass =
  "mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary";

export function CollectionsWorkspace({
  students,
  cashAccounts,
  month,
  monthLabel,
  monthEnd,
  today,
}: {
  students: CollectibleStudent[];
  cashAccounts: { id: string; name: string }[];
  month: string;
  monthLabel: string;
  /** Bekleyen listesi bu tarihe kadar başlayan dönemleri gösterir. */
  monthEnd: string;
  today: string;
}) {
  const formRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState("cash");
  const [search, setSearch] = useState("");

  const selectedStudent = students.find((item) => item.studentId === selection?.studentId);
  const selectedCourse = selectedStudent?.courses.find(
    (item) => item.courseId === selection?.courseId,
  );

  const totalOpen = sumPending(selectedCourse?.openAccruals ?? []);
  const amount = parseAmount(amountInput);

  const allocation = previewAllocation(selectedCourse?.openAccruals ?? [], amount);

  const pendingRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("tr-TR");

    return students
      .flatMap((student) =>
        student.courses.map((course) => {
          const due = course.openAccruals.filter((item) => item.periodStart <= monthEnd);

          return {
            student,
            course,
            due,
            pending: sumPending(due),
            allocated: due.reduce((sum, item) => sum + item.allocated, 0),
            overdue: due.some((item) => item.overdue),
          };
        }),
      )
      .filter((row) => row.pending > 0.01)
      .filter(
        (row) =>
          !query ||
          row.student.studentName.toLocaleLowerCase("tr-TR").includes(query) ||
          row.course.courseName.toLocaleLowerCase("tr-TR").includes(query),
      )
      .sort(
        (a, b) =>
          Number(b.overdue) - Number(a.overdue) ||
          a.student.studentName.localeCompare(b.student.studentName, "tr-TR"),
      );
  }, [students, monthEnd, search]);

  const pendingTotal = pendingRows.reduce((sum, row) => sum + row.pending, 0);

  function select(studentId: string, courseId?: string) {
    const student = students.find((item) => item.studentId === studentId);

    if (!student) {
      setSelection(null);
      setAmountInput("");
      return;
    }

    const course =
      student.courses.find((item) => item.courseId === courseId) ??
      student.courses.find((item) => sumPending(item.openAccruals) > 0) ??
      student.courses[0];

    if (!course) {
      setSelection(null);
      return;
    }

    setSelection({ studentId, courseId: course.courseId });

    const open = sumPending(course.openAccruals);
    setAmountInput((open > 0 ? open : course.netMonthlyFee).toFixed(2));
  }

  function collectFor(studentId: string, courseId: string) {
    select(studentId, courseId);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const remainingAfter = Math.max(0, totalOpen - amount);

  return (
    <>
      <div
        ref={formRef}
        id="tahsilat-al"
        className="scroll-mt-6 rounded-2xl border border-primary/30 bg-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-bold text-text-primary">Tahsilat al</h3>
          <p className="text-xs text-text-secondary">
            Öğrenciden alınan tutarı girin — kısmi ödeme de olabilir, kalan borç açık kalır.
          </p>
        </div>

        {students.length === 0 ? (
          <p className="mt-4 rounded-xl bg-surface-muted p-4 text-sm text-text-secondary">
            Tahsilat alınabilecek ders kaydı yok. Önce bir öğrenciyi derse kaydedin.
          </p>
        ) : (
          <form action={recordPayment} className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <input type="hidden" name="month" value={month} />
            <input type="hidden" name="studentId" value={selection?.studentId ?? ""} />

            <label className="text-xs font-medium text-text-secondary md:col-span-2">
              Öğrenci
              <select
                required
                value={selection?.studentId ?? ""}
                onChange={(event) => select(event.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  Öğrenci seçin
                </option>
                {students.map((student) => {
                  const open = student.courses.reduce(
                    (sum, course) => sum + sumPending(course.openAccruals),
                    0,
                  );

                  return (
                    <option key={student.studentId} value={student.studentId}>
                      {student.studentName}
                      {open > 0 ? ` — ${formatTry(open)} borç` : ""}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className="text-xs font-medium text-text-secondary md:col-span-2">
              Ders
              <select
                name="courseId"
                required
                disabled={!selectedStudent}
                value={selection?.courseId ?? ""}
                onChange={(event) =>
                  selection && select(selection.studentId, event.target.value)
                }
                className={inputClass}
              >
                {!selectedStudent && <option value="">Önce öğrenci seçin</option>}
                {selectedStudent?.courses.map((course) => (
                  <option key={course.courseId} value={course.courseId}>
                    {course.courseName}
                  </option>
                ))}
              </select>
            </label>

            {selectedCourse && (
              <div className="grid gap-3 rounded-xl bg-surface-muted p-4 text-sm sm:grid-cols-3 md:col-span-2 xl:col-span-4">
                <div>
                  <p className="text-xs text-text-secondary">Öğrencinin aylık ücreti</p>
                  <p className="mt-1 font-semibold text-text-primary">
                    {formatTry(selectedCourse.netMonthlyFee)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Açık dönemler</p>
                  <p className="mt-1 text-text-primary">
                    {selectedCourse.openAccruals.length === 0
                      ? "Yok"
                      : selectedCourse.openAccruals
                          .map((item) => `${item.periodLabel}: ${formatTry(item.pending)}`)
                          .join(" · ")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Toplam kalan borç</p>
                  <p
                    className={`mt-1 text-lg font-bold ${totalOpen > 0 ? "text-danger" : "text-success"}`}
                  >
                    {formatTry(totalOpen)}
                  </p>
                </div>
              </div>
            )}

            <label className="text-xs font-medium text-text-secondary">
              Alınan tutar (₺)
              <input
                type="text"
                name="amount"
                required
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                placeholder="Örn. 1000"
                className={inputClass}
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Tahsilat tarihi
              <input
                type="date"
                name="receivedOn"
                required
                defaultValue={today}
                max={today}
                className={inputClass}
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Yöntem
              <select
                name="method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                className={inputClass}
              >
                {methodOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            {method === "cash" ? (
              cashAccounts.length > 1 ? (
                <label className="text-xs font-medium text-text-secondary">
                  Kasa hesabı
                  <select name="cashAccountId" required defaultValue="" className={inputClass}>
                    <option value="" disabled>
                      Seçin
                    </option>
                    {cashAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : cashAccounts.length === 1 ? (
                <div className="text-xs font-medium text-text-secondary">
                  Kasa hesabı
                  <input type="hidden" name="cashAccountId" value={cashAccounts[0].id} />
                  <p className="mt-1 rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-text-primary">
                    {cashAccounts[0].name}
                  </p>
                </div>
              ) : (
                <p className="self-end text-xs text-text-secondary">
                  Henüz kasa hesabı yok — ilk nakit tahsilatta &ldquo;Ana Kasa&rdquo; otomatik
                  açılır.
                </p>
              )
            ) : (
              <div className="hidden xl:block" />
            )}

            <label className="text-xs font-medium text-text-secondary md:col-span-2 xl:col-span-3">
              Açıklama
              <input
                type="text"
                name="note"
                placeholder="Örn. Ekim ön ödemesi, kalan ay sonunda"
                className={inputClass}
              />
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={!selectedCourse || amount <= 0}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.98] disabled:opacity-50"
              >
                Tahsilatı kaydet
              </button>
            </div>

            {selectedCourse && amount > 0 && (
              <div className="rounded-lg border border-dashed border-border bg-surface p-3 text-xs md:col-span-2 xl:col-span-4">
                <p className="font-semibold text-text-secondary">
                  {formatTry(amount)} şu dönemlere dağıtılacak (en eskiden başlayarak):
                </p>

                {allocation.lines.length === 0 ? (
                  <p className="mt-1.5 text-text-secondary">
                    Bu derste açık dönem yok — tutar avans olarak kalır.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {allocation.lines.map((line) => (
                      <li key={line.accrualId} className="flex justify-between gap-3">
                        <span className="text-text-primary">
                          {line.periodLabel}
                          {line.overdue ? " (gecikmiş)" : ""}
                          {line.allocated + 0.01 < line.pending
                            ? ` — kısmi, ${formatTry(line.pending - line.allocated)} kalır`
                            : " — kapanır"}
                        </span>
                        <span className="font-semibold text-text-primary">
                          {formatTry(line.allocated)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-2 flex justify-between gap-3 border-t border-border pt-2 font-semibold">
                  <span className="text-text-secondary">Tahsilattan sonra kalan borç</span>
                  <span className={remainingAfter > 0 ? "text-danger" : "text-success"}>
                    {formatTry(remainingAfter)}
                  </span>
                </p>

                {allocation.remainder > 0.01 && (
                  <p className="mt-1 flex justify-between gap-3 font-semibold text-info">
                    <span>Fazla ödeme (avans olarak kalır)</span>
                    <span>{formatTry(allocation.remainder)}</span>
                  </p>
                )}
              </div>
            )}
          </form>
        )}
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-semibold text-text-primary">Bekleyen tahsilatlar</h3>
          <p className="text-xs text-text-secondary">
            {monthLabel} dahil, henüz tamamı alınmamış tüm dönemler — toplam{" "}
            <span className="font-semibold text-danger">{formatTry(pendingTotal)}</span>
          </p>
        </div>

        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Öğrenci veya ders ara"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary sm:w-64"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {pendingRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-secondary">
            {search ? "Aramaya uyan bekleyen tahsilat yok." : "Bekleyen tahsilat yok."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-5 py-3">Öğrenci</th>
                  <th className="px-5 py-3">Ders</th>
                  <th className="px-5 py-3">Dönem</th>
                  <th className="px-5 py-3">Alınan</th>
                  <th className="px-5 py-3">Kalan</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pendingRows.map((row) => (
                  <tr
                    key={`${row.student.studentId}:${row.course.courseId}`}
                    className="hover:bg-surface-muted"
                  >
                    <td className="px-5 py-3 font-medium text-text-primary">
                      {row.student.studentName}
                    </td>
                    <td className="px-5 py-3 text-text-secondary">{row.course.courseName}</td>
                    <td className="px-5 py-3 text-text-secondary">
                      {row.due.map((item) => item.periodLabel).join(", ")}
                      {row.overdue && (
                        <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">
                          Gecikmiş
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-text-secondary">
                      {row.allocated > 0 ? formatTry(row.allocated) : "—"}
                    </td>
                    <td className="px-5 py-3 font-semibold text-danger">
                      {formatTry(row.pending)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => collectFor(row.student.studentId, row.course.courseId)}
                        className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-surface-muted"
                      >
                        Tahsilat al
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function sumPending(items: OpenAccrualItem[]) {
  return items.reduce((sum, item) => sum + item.pending, 0);
}

function parseAmount(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/** record_payment_for_course() ile aynı sıra: en eski dönemden başlayarak. */
function previewAllocation(openAccruals: OpenAccrualItem[], amount: number) {
  let remaining = amount;
  const lines: (OpenAccrualItem & { allocated: number })[] = [];

  for (const accrual of openAccruals) {
    if (remaining <= 0) {
      break;
    }

    const allocated = Math.min(remaining, accrual.pending);

    if (allocated > 0.01) {
      lines.push({ ...accrual, allocated });
      remaining -= allocated;
    }
  }

  return { lines, remainder: Math.max(0, remaining) };
}
