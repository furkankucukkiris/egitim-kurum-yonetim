import { replyTeacherRequest, setTeacherRequestStatus } from "@/app/(dashboard)/talepler/actions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { cn } from "@/lib/utils";

export type RequestItem = {
  id: string;
  body: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  teacherProfileId: string;
  teacherName: string;
  studentName: string | null;
  sessionLabel: string | null;
  hasUnseenReply: boolean;
  replies: {
    id: string;
    author_profile_id: string;
    body: string;
    created_at: string;
  }[];
};

export function RequestCard({
  item,
  isAdmin,
  filter,
  returnSession,
}: {
  item: RequestItem;
  isAdmin: boolean;
  filter: string;
  returnSession: string | null;
}) {
  const resolved = item.status === "resolved";

  // Formlar işlem sonrası aynı filtreye dönebilsin diye.
  const hiddenContext = (
    <>
      <input type="hidden" name="requestId" value={item.id} />
      <input type="hidden" name="filter" value={filter} />
      {returnSession && <input type="hidden" name="returnSession" value={returnSession} />}
    </>
  );

  return (
    <article
      className={cn(
        "rounded-2xl border bg-surface p-5",
        item.hasUnseenReply ? "border-accent/60" : "border-border",
        resolved && "opacity-90",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {isAdmin && <span className="font-semibold text-text-primary">{item.teacherName}</span>}
          <span className="text-xs text-text-secondary">{formatDateTime(item.createdAt)}</span>
          {item.studentName && <StatusBadge label={`Öğrenci: ${item.studentName}`} tone="info" />}
          {item.sessionLabel && <StatusBadge label={item.sessionLabel} />}
        </div>

        <div className="flex items-center gap-2">
          {item.hasUnseenReply && <StatusBadge label="Yeni yanıt" tone="warning" />}
          <StatusBadge
            label={
              resolved
                ? `Kapandı${item.resolvedAt ? ` · ${formatDateTime(item.resolvedAt)}` : ""}`
                : "Açık"
            }
            tone={resolved ? "success" : "warning"}
          />
        </div>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-text-primary">{item.body}</p>

      {item.replies.length > 0 && (
        <ol className="mt-4 space-y-2 border-l-2 border-border pl-4">
          {item.replies.map((reply) => {
            const fromTeacher = reply.author_profile_id === item.teacherProfileId;

            return (
              <li
                key={reply.id}
                className={cn(
                  "rounded-xl p-3 text-sm",
                  fromTeacher ? "bg-surface-muted" : "bg-accent-soft",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text-primary">
                    {fromTeacher ? (isAdmin ? item.teacherName : "Siz") : "Yönetici"}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {formatDateTime(reply.created_at)}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-text-primary">{reply.body}</p>
              </li>
            );
          })}
        </ol>
      )}

      <form action={replyTeacherRequest} className="mt-4 flex flex-col gap-2">
        {hiddenContext}

        <textarea
          name="body"
          required
          rows={2}
          maxLength={2000}
          placeholder={
            isAdmin
              ? "Yanıt yazın (ör. Sipariş verildi)"
              : resolved
                ? "Ek bilgi yazarsanız konu yeniden açılır"
                : "Ek bilgi yazın"
          }
          className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
        />

        <div className="flex flex-wrap justify-end gap-2">
          {isAdmin && (
            <button
              type="submit"
              formAction={setTeacherRequestStatus}
              name="status"
              value={resolved ? "open" : "resolved"}
              formNoValidate
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-hover"
            >
              {resolved ? "Yeniden aç" : "Yanıtsız kapat"}
            </button>
          )}

          <button
            type="submit"
            className="rounded-lg border border-primary px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary-soft"
          >
            Yanıtla
          </button>

          {isAdmin && !resolved && (
            <button
              type="submit"
              name="resolve"
              value="1"
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:bg-primary-hover active:scale-[0.98]"
            >
              Yanıtla ve kapat
            </button>
          )}
        </div>
      </form>
    </article>
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
