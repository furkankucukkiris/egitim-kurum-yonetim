import Link from "next/link";

export type SessionRequestSummary = {
  open: number;
  resolved: number;
};

// Yoklama kartındaki eski "Yorumlar" bölümünün yerini alır: oturuma bağlı
// not/talepleri özetler ve /talepler sayfasına yönlendirir.
export function SessionRequests({
  sessionId,
  summary,
  canWrite,
}: {
  sessionId: string;
  summary: SessionRequestSummary;
  canWrite: boolean;
}) {
  const total = summary.open + summary.resolved;

  if (total === 0 && !canWrite) {
    return null;
  }

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
      <span className="text-text-secondary">
        {total === 0
          ? "Bu derse bağlı not yok."
          : `Notlar & talepler: ${total}${summary.open > 0 ? ` (${summary.open} açık)` : ""}`}
      </span>

      <div className="flex items-center gap-3">
        {total > 0 && (
          <Link
            href={`/talepler?durum=tumu&seans=${sessionId}`}
            className="font-semibold text-primary hover:underline"
          >
            Görüntüle
          </Link>
        )}

        {canWrite && (
          <Link
            href={`/talepler?seans=${sessionId}`}
            className="font-semibold text-primary hover:underline"
          >
            Not / talep yaz
          </Link>
        )}
      </div>
    </div>
  );
}
