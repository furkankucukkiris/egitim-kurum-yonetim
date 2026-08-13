"use client";

import { useMemo, useState } from "react";
import { formatTry } from "@/lib/utils";
import { recordPayment } from "@/app/(dashboard)/odemeler/actions";

export type StudentPaymentStatus = "paid" | "partial" | "pending";

export type OpenAccrualItem = {
  accrualId: string;
  periodLabel: string;
  pending: number;
  overdue: boolean;
};

export type StudentPaymentRow = {
  studentId: string;
  studentName: string;
  status: StudentPaymentStatus;
  /** Seçili ayın tahakkuku/tahsilatı/bekleyeni — kart bu ayla sınırlı. */
  monthNet: number;
  monthAllocated: number;
  monthPending: number;
  otherCourses: string[];
  /**
   * Bu öğrencinin bu derste TÜM açık dönemleri (yalnızca bu ay değil),
   * en eski dönemden başlayarak sıralı. Ödeme önizlemesi ve formun
   * varsayılan tutarı bunu kullanır — record_payment_for_course()
   * ödemeyi tam bu sırayla dağıtır.
   */
  openAccruals: OpenAccrualItem[];
  totalOpenAcrossPeriods: number;
};

export type CoursePaymentGroup = {
  courseId: string;
  courseName: string;
  rows: StudentPaymentRow[];
  totals: {
    pending: number;
    received: number;
    total: number;
  };
};

const statusLabels: Record<StudentPaymentStatus, string> = {
  paid: "Ödendi",
  partial: "Kısmi",
  pending: "Bekliyor",
};

const statusClasses: Record<StudentPaymentStatus, string> = {
  paid: "bg-success-soft text-success",
  partial: "bg-accent-soft text-accent-strong",
  pending: "bg-danger-soft text-danger",
};

export function CoursePaymentCard({
  group,
  month,
  cashAccounts,
  defaultOpen = false,
}: {
  group: CoursePaymentGroup;
  month: string;
  cashAccounts: { id: string; name: string }[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const pendingCount = group.rows.filter((row) => row.status !== "paid").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-surface-muted"
      >
        <div className="flex items-center gap-3">
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm transition-transform ${
              open ? "rotate-90" : ""
            }`}
          >
            ›
          </span>

          <div>
            <h3 className="font-semibold text-text-primary">{group.courseName}</h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              {group.rows.length === 0
                ? "Kayıt yok"
                : pendingCount === 0
                  ? `${group.rows.length} öğrenci — tamamı ödendi`
                  : `${pendingCount}/${group.rows.length} öğrenci bekliyor`}
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-xs text-text-secondary">Bekleyen (bu ay)</p>
          <p
            className={`text-lg font-bold ${
              group.totals.pending > 0 ? "text-danger" : "text-text-primary"
            }`}
          >
            {formatTry(group.totals.pending)}
          </p>
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          {group.rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-secondary">
              Bu derste öğrenci kaydı yok.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
                  <tr>
                    <th className="px-5 py-3">Öğrenci</th>
                    <th className="px-5 py-3">Durum</th>
                    <th className="px-5 py-3">Bu ay</th>
                    <th className="px-5 py-3">Diğer dersler</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-line">
                  {group.rows.map((row) => (
                    <StudentRow
                      key={row.studentId}
                      row={row}
                      courseId={group.courseId}
                      month={month}
                      cashAccounts={cashAccounts}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-3 divide-x divide-line border-t border-border text-sm">
            <div className="px-5 py-3">
              <p className="text-xs text-text-secondary">Bekleyen (bu ay)</p>
              <p className="mt-1 font-semibold text-danger">{formatTry(group.totals.pending)}</p>
            </div>

            <div className="px-5 py-3">
              <p className="text-xs text-text-secondary">Alınan (bu ay)</p>
              <p className="mt-1 font-semibold text-success">{formatTry(group.totals.received)}</p>
            </div>

            <div className="px-5 py-3">
              <p className="text-xs text-text-secondary">Toplam (bu ay)</p>
              <p className="mt-1 font-semibold text-text-primary">
                {formatTry(group.totals.total)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentRow({
  row,
  courseId,
  month,
  cashAccounts,
}: {
  row: StudentPaymentRow;
  courseId: string;
  month: string;
  cashAccounts: { id: string; name: string }[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [method, setMethod] = useState("cash");

  const defaultAmount =
    row.totalOpenAcrossPeriods > 0 ? row.totalOpenAcrossPeriods : row.monthPending;

  const [amountInput, setAmountInput] = useState(defaultAmount.toFixed(2));

  const allocation = useMemo(
    () => previewAllocation(row.openAccruals, parseAmount(amountInput)),
    [row.openAccruals, amountInput],
  );

  return (
    <>
      <tr>
        <td className="px-5 py-4 font-medium text-text-primary">{row.studentName}</td>

        <td className="px-5 py-4">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[row.status]}`}
          >
            {statusLabels[row.status]}
          </span>
        </td>

        <td className="px-5 py-4">
          {row.status === "paid" ? (
            <span className="font-semibold text-text-primary">{formatTry(row.monthNet)}</span>
          ) : row.status === "partial" ? (
            <div className="text-xs leading-5">
              <p className="font-semibold text-accent-strong">
                {formatTry(row.monthAllocated)} ödendi
              </p>
              <p className="text-danger">{formatTry(row.monthPending)} kaldı</p>
            </div>
          ) : (
            <span className="font-semibold text-danger">{formatTry(row.monthPending)}</span>
          )}

          {row.totalOpenAcrossPeriods > row.monthPending + 0.01 && (
            <p className="mt-1 text-xs text-text-secondary">
              Toplam açık (tüm dönemler): {formatTry(row.totalOpenAcrossPeriods)}
            </p>
          )}
        </td>

        <td className="px-5 py-4 text-text-secondary">
          {row.otherCourses.length > 0 ? row.otherCourses.join(", ") : "—"}
        </td>

        <td className="px-5 py-4 text-right">
          {row.status !== "paid" && (
            <button
              type="button"
              onClick={() => setFormOpen((value) => !value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-surface-muted text-primary"
            >
              {formOpen ? "Vazgeç" : "Öde"}
            </button>
          )}
        </td>
      </tr>

      {formOpen && (
        <tr>
          <td colSpan={5} className="bg-surface-muted px-5 py-4">
            <form action={recordPayment} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="studentId" value={row.studentId} />
              <input type="hidden" name="courseId" value={courseId} />
              <input type="hidden" name="month" value={month} />

              <label className="text-xs font-medium text-text-secondary">
                Tutar
                <input
                  type="text"
                  name="amount"
                  required
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  className="mt-1 block w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
              </label>

              <label className="text-xs font-medium text-text-secondary">
                Yöntem
                <select
                  name="method"
                  value={method}
                  onChange={(event) => setMethod(event.target.value)}
                  className="mt-1 block w-36 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                >
                  <option value="cash">Nakit</option>
                  <option value="bank_transfer">Havale</option>
                  <option value="card">Kart</option>
                  <option value="online">Online</option>
                  <option value="other">Diğer</option>
                </select>
              </label>

              {method === "cash" && cashAccounts.length > 0 && (
                <label className="text-xs font-medium text-text-secondary">
                  Kasa hesabı
                  <select
                    name="cashAccountId"
                    required
                    defaultValue=""
                    className="mt-1 block w-40 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  >
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
              )}

              {method === "cash" && cashAccounts.length === 0 && (
                <p className="text-xs text-danger">
                  Nakit ödeme için önce Kurum Ayarları → Kasa &amp; Banka&apos;dan bir kasa hesabı
                  ekleyin.
                </p>
              )}

              <label className="min-w-[200px] flex-1 text-xs font-medium text-text-secondary">
                Açıklama
                <input
                  type="text"
                  name="note"
                  placeholder="Örn. 500₺ kardeş indirimi"
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
              </label>

              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Ödemeyi kaydet
              </button>

              <div className="w-full rounded-lg border border-dashed border-border bg-surface p-3 text-xs">
                <p className="font-semibold text-text-secondary">
                  Bu tutar şu dönemlere dağıtılacak (en eskiden başlayarak):
                </p>

                {allocation.lines.length === 0 ? (
                  <p className="mt-1.5 text-text-secondary">
                    Bu derste açık dönem bulunmuyor — tutar avans olarak kalır.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {allocation.lines.map((line) => (
                      <li key={line.accrualId} className="flex justify-between gap-3">
                        <span className="text-text-primary">
                          {line.periodLabel}
                          {line.overdue ? " (gecikmiş)" : ""}
                        </span>
                        <span className="font-semibold text-text-primary">
                          {formatTry(line.allocated)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {allocation.remainder > 0.01 && (
                  <p className="mt-1.5 flex justify-between gap-3 font-semibold text-info text-info">
                    <span>Dağıtılmayan (avans olarak kalır)</span>
                    <span>{formatTry(allocation.remainder)}</span>
                  </p>
                )}
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function parseAmount(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

/**
 * record_payment_for_course() (supabase/migrations/
 * 20260808120000_add_accrual_automation_and_payment_recording.sql)
 * ile birebir aynı mantık: en eski döneme, o dönemin bekleyeninden
 * fazla olmayacak şekilde sırayla dağıt. Bu yalnızca bir ÖNİZLEME —
 * gerçek dağıtım sunucu tarafında, aynı algoritmayla yapılır.
 */
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
