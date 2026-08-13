import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import { refundPayment, allocateAdvance } from "./actions";

type PaymentDetail = {
  payment_id: string;
  student_id: string;
  student_name: string;
  course_id: string | null;
  course_name: string | null;
  amount: number | string;
  method: string;
  received_at: string;
  note: string | null;
  receipt_number: string | null;
  recorded_by_name: string | null;
  is_refunded: boolean;
  allocated_total: number | string;
  refunded_total: number | string;
  unallocated_total: number | string;
};

type AllocationDetail = {
  allocation_id: string;
  accrual_id: string;
  period_start: string;
  description: string;
  amount: number | string;
  reversed_amount: number | string;
};

type RefundDetail = {
  refund_id: string;
  amount: number | string;
  refund_type: "reversal" | "refund";
  reason: string;
  created_by_name: string | null;
  created_at: string;
};

type OpenAccrualOption = {
  id: string;
  period_start: string;
  description: string;
  net_amount: number;
  allocated_amount: number;
  course: { name: string } | null;
};

const methodLabels: Record<string, string> = {
  cash: "Nakit",
  bank_transfer: "Havale",
  card: "Kart",
  online: "Online",
  other: "Diğer",
};

const refundTypeLabels: Record<string, string> = {
  reversal: "Ters işlem (hatalı kayıt düzeltmesi)",
  refund: "İade",
};

type PageProps = {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function PaymentDetailPage({ params, searchParams }: PageProps) {
  await requireRole(["admin"]);

  const { paymentId } = await params;
  const query = await searchParams;

  const supabase = await createClient();

  const [detailResult, allocationsResult, refundsResult] = await Promise.all([
    supabase.rpc("get_payment_detail", { p_payment_id: paymentId }),
    supabase.rpc("get_payment_allocations_detail", { p_payment_id: paymentId }),
    supabase.rpc("get_payment_refunds_detail", { p_payment_id: paymentId }),
  ]);

  if (detailResult.error) {
    console.error("Ödeme detayı alınamadı:", detailResult.error);
  }

  const payment = ((detailResult.data ?? []) as unknown as PaymentDetail[])[0];

  if (!payment) {
    notFound();
  }

  if (allocationsResult.error) {
    console.error("Ödeme tahsisleri alınamadı:", allocationsResult.error);
  }

  if (refundsResult.error) {
    console.error("Ödeme iade geçmişi alınamadı:", refundsResult.error);
  }

  const allocations = (allocationsResult.data ?? []) as unknown as AllocationDetail[];
  const refunds = (refundsResult.data ?? []) as unknown as RefundDetail[];

  const unallocatedTotal = Number(payment.unallocated_total);
  const refundableTotal = Number(payment.amount) - Number(payment.refunded_total);

  let openAccruals: OpenAccrualOption[] = [];

  if (unallocatedTotal > 0.01) {
    const openResult = await supabase
      .from("accruals")
      .select(
        `
          id, period_start, description, net_amount, allocated_amount,
          course:courses ( name )
        `,
      )
      .eq("student_id", payment.student_id)
      .in("status", ["open", "partial", "overdue"])
      .order("period_start", { ascending: true });

    if (openResult.error) {
      console.error("Öğrencinin açık tahakkukları alınamadı:", openResult.error);
    }

    openAccruals = (openResult.data ?? []) as unknown as OpenAccrualOption[];
  }

  return (
    <>
      <PageHeader
        title={`Ödeme detayı${payment.receipt_number ? ` — ${payment.receipt_number}` : ""}`}
        description={payment.student_name}
        action={
          <Link
            href="/odemeler"
            className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-text-primary transition hover:bg-surface-muted"
          >
            ← Ödemelere dön
          </Link>
        }
      />

      {query.success && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {query.success}
        </div>
      )}

      {query.error && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {query.error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <h3 className="font-semibold text-text-primary">Ödeme bilgisi</h3>

            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label="Öğrenci" value={payment.student_name} />
              <Field label="Ders" value={payment.course_name ?? "—"} />
              <Field label="Tutar" value={formatTry(Number(payment.amount))} />
              <Field label="Yöntem" value={methodLabels[payment.method] ?? payment.method} />
              <Field label="Tarih" value={formatDateTime(payment.received_at)} />
              <Field label="Kaydeden" value={payment.recorded_by_name ?? "—"} />
              <Field label="Makbuz No" value={payment.receipt_number ?? "—"} />
              <Field label="Tahsis edilen" value={formatTry(Number(payment.allocated_total))} />
              <Field label="İade edilen" value={formatTry(Number(payment.refunded_total))} />
              <Field
                label="Dağıtılmamış (avans)"
                value={formatTry(unallocatedTotal)}
                emphasis={unallocatedTotal > 0.01}
              />
            </dl>

            {payment.note && (
              <p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm text-text-secondary">
                {payment.note}
              </p>
            )}

            {payment.is_refunded && (
              <p className="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                Bu ödeme tamamen iade edilmiştir.
              </p>
            )}
          </Card>

          <Card>
            <h3 className="font-semibold text-text-primary">Tahsis edildiği dönemler</h3>

            {allocations.length === 0 ? (
              <p className="mt-3 text-sm text-text-secondary">
                Bu ödeme henüz hiçbir tahakkuka tahsis edilmedi.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
                    <tr>
                      <th className="px-4 py-2.5">Dönem</th>
                      <th className="px-4 py-2.5">Açıklama</th>
                      <th className="px-4 py-2.5">Tahsis edilen</th>
                      <th className="px-4 py-2.5">Geri alınan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {allocations.map((allocation) => (
                      <tr key={allocation.allocation_id}>
                        <td className="px-4 py-3 font-medium text-text-primary">
                          {formatMonthYear(allocation.period_start)}
                        </td>
                        <td className="px-4 py-3 text-text-secondary">{allocation.description}</td>
                        <td className="px-4 py-3 font-semibold text-text-primary">
                          {formatTry(Number(allocation.amount))}
                        </td>
                        <td className="px-4 py-3 text-danger">
                          {Number(allocation.reversed_amount) > 0
                            ? formatTry(Number(allocation.reversed_amount))
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="font-semibold text-text-primary">İade / ters işlem geçmişi</h3>

            {refunds.length === 0 ? (
              <p className="mt-3 text-sm text-text-secondary">
                Bu ödeme için henüz iade/ters işlem kaydı yok.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {refunds.map((refund) => (
                  <li key={refund.refund_id} className="rounded-xl bg-surface-muted p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-text-primary">
                        {refundTypeLabels[refund.refund_type] ?? refund.refund_type} —{" "}
                        {formatTry(Number(refund.amount))}
                      </span>
                      <span className="text-xs text-text-secondary">
                        {formatDateTime(refund.created_at)} · {refund.created_by_name ?? "—"}
                      </span>
                    </div>
                    <p className="mt-1.5 text-text-secondary">{refund.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {refundableTotal > 0.01 && (
            <Card>
              <h3 className="font-semibold text-text-primary">İade / ters işlem kaydet</h3>

              <p className="mt-1 text-xs text-text-secondary">
                En fazla {formatTry(refundableTotal)} iade edilebilir. Önce ödemenin dağıtılmamış
                kısmından düşülür; kalan varsa en yeni dönemden başlayarak tahsisler geri alınır ve
                ilgili tahakkuk yeniden açık/kısmi duruma döner.
              </p>

              <form action={refundPayment} className="mt-4 space-y-3">
                <input type="hidden" name="paymentId" value={payment.payment_id} />

                <label className="block text-sm font-medium">
                  Tür
                  <select
                    name="refundType"
                    defaultValue="refund"
                    className="mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
                  >
                    <option value="refund">İade (paranın gerçekten geri ödenmesi)</option>
                    <option value="reversal">Ters işlem (hatalı kayıt düzeltmesi)</option>
                  </select>
                </label>

                <label className="block text-sm font-medium">
                  Tutar
                  <input
                    type="text"
                    name="amount"
                    required
                    defaultValue={refundableTotal.toFixed(2)}
                    className="mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </label>

                <label className="block text-sm font-medium">
                  Gerekçe
                  <input
                    type="text"
                    name="reason"
                    required
                    minLength={3}
                    placeholder="ör. yanlış öğrenciye kaydedilmiş"
                    className="mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
                  />
                </label>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-danger px-4 py-2.5 text-sm font-semibold text-on-primary transition hover:bg-danger/90"
                >
                  İade/ters işlemi kaydet
                </button>
              </form>
            </Card>
          )}

          {unallocatedTotal > 0.01 && (
            <Card>
              <h3 className="font-semibold text-text-primary">Avansı bir tahakkuka uygula</h3>

              <p className="mt-1 text-xs text-text-secondary">
                Bu ödemenin {formatTry(unallocatedTotal)} tutarındaki dağıtılmamış kısmı, öğrencinin
                başka bir açık tahakkukuna uygulanabilir. Otomatik dağıtım yoktur — yalnızca burada
                seçtiğiniz tahakkuk için, sizin onayınızla uygulanır.
              </p>

              {openAccruals.length === 0 ? (
                <p className="mt-3 text-sm text-text-secondary">
                  Öğrencinin başka açık tahakkuku bulunmuyor.
                </p>
              ) : (
                <form action={allocateAdvance} className="mt-4 space-y-3">
                  <input type="hidden" name="paymentId" value={payment.payment_id} />

                  <label className="block text-sm font-medium">
                    Hedef tahakkuk
                    <select
                      name="accrualId"
                      required
                      className="mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
                    >
                      {openAccruals.map((accrual) => (
                        <option key={accrual.id} value={accrual.id}>
                          {formatMonthYear(accrual.period_start)} —{" "}
                          {accrual.course?.name ?? "Ders bilgisi yok"} — bekleyen{" "}
                          {formatTry(
                            Math.max(
                              0,
                              Number(accrual.net_amount) - Number(accrual.allocated_amount),
                            ),
                          )}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm font-medium">
                    Tutar
                    <input
                      type="text"
                      name="amount"
                      required
                      defaultValue={unallocatedTotal.toFixed(2)}
                      className="mt-1 w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
                    />
                  </label>

                  <button
                    type="submit"
                    className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
                  >
                    Avansı uygula
                  </button>
                </form>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd
        className={`mt-1 font-semibold ${emphasis ? "text-info text-info" : "text-text-primary"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMonthYear(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
