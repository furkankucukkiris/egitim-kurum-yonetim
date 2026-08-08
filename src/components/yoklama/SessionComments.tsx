"use client";

import { useState } from "react";
import { addSessionComment, deleteSessionComment } from "@/app/(dashboard)/yoklama/comment-actions";

export type SessionComment = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorRole: string;
};

const roleLabels: Record<string, string> = {
  admin: "Yönetici",
  teacher: "Öğretmen",
};

export function SessionComments({
  sessionId,
  date,
  comments,
  canComment,
  canDelete,
}: {
  sessionId: string;
  date: string;
  comments: SessionComment[];
  canComment: boolean;
  canDelete: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-100"
      >
        <span>Yorumlar{comments.length > 0 ? ` (${comments.length})` : ""}</span>
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {comments.length === 0 ? (
            <p className="text-xs text-muted">Henüz yorum yok.</p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="rounded-xl bg-fill p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-ink">
                    {comment.authorName}
                    <span className="ml-1.5 text-xs font-normal text-muted">
                      {roleLabels[comment.authorRole] ?? comment.authorRole}
                    </span>
                  </span>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted">{formatDateTime(comment.createdAt)}</span>

                    {canDelete && (
                      <form action={deleteSessionComment}>
                        <input type="hidden" name="commentId" value={comment.id} />
                        <input type="hidden" name="date" value={date} />
                        <button
                          type="submit"
                          className="text-xs font-semibold text-rose-700 transition hover:underline dark:text-rose-400"
                        >
                          Sil
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                <p className="mt-1.5 whitespace-pre-wrap text-ink">{comment.body}</p>
              </div>
            ))
          )}

          {canComment && (
            <form action={addSessionComment} className="flex flex-col gap-2">
              <input type="hidden" name="lessonSessionId" value={sessionId} />
              <input type="hidden" name="date" value={date} />

              <textarea
                name="body"
                required
                rows={2}
                maxLength={2000}
                placeholder="Yorum yaz..."
                className="w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />

              <button
                type="submit"
                className="self-end rounded-lg bg-terra-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50"
              >
                Gönder
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
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
