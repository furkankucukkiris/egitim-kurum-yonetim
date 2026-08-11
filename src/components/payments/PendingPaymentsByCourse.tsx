"use client";

import { CoursePaymentCard, type CoursePaymentGroup } from "./CoursePaymentCard";

export function PendingPaymentsByCourse({
  groups,
  month,
  cashAccounts,
}: {
  groups: CoursePaymentGroup[];
  month: string;
  cashAccounts: { id: string; name: string }[];
}) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-panel px-6 py-16 text-center shadow-sm">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-fill text-2xl">
          ₺
        </div>

        <h3 className="mt-5 text-lg font-bold text-ink">
          Bu ay için tahakkuk kaydı yok
        </h3>

        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          Aşağıdaki &ldquo;Bu ayın tahakkuklarını oluştur&rdquo; ile mevcut
          kayıtlı öğrenciler için bu ayın ödemelerini oluşturabilirsiniz.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <CoursePaymentCard
          key={group.courseId}
          group={group}
          month={month}
          cashAccounts={cashAccounts}
        />
      ))}
    </div>
  );
}
