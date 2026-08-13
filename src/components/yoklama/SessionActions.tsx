"use client";

import { useState } from "react";
import {
  cancelSession,
  rescheduleSession,
  requestSessionChange,
} from "@/app/(dashboard)/yoklama/session-actions";

type Panel = "cancel" | "reschedule" | "request" | null;

export function SessionActions({
  sessionId,
  date,
  isAdmin,
  canRequest,
  pendingRequestType,
}: {
  sessionId: string;
  date: string;
  isAdmin: boolean;
  canRequest: boolean;
  pendingRequestType: "cancel" | "reschedule" | null;
}) {
  const [panel, setPanel] = useState<Panel>(null);

  if (pendingRequestType) {
    return (
      <div className="mt-4 rounded-xl border border-info/30 bg-info-soft p-3 text-xs font-semibold text-info border-info/30 bg-info-soft text-info">
        {pendingRequestType === "cancel"
          ? "İptal talebiniz yönetici onayını bekliyor."
          : "Yeniden planlama talebiniz yönetici onayını bekliyor."}
      </div>
    );
  }

  if (!isAdmin && !canRequest) {
    return null;
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap gap-2">
        {isAdmin ? (
          <>
            <ToggleButton
              active={panel === "cancel"}
              onClick={() => setPanel(panel === "cancel" ? null : "cancel")}
              label="İptal et"
            />
            <ToggleButton
              active={panel === "reschedule"}
              onClick={() => setPanel(panel === "reschedule" ? null : "reschedule")}
              label="Yeniden planla"
            />
          </>
        ) : (
          <ToggleButton
            active={panel === "request"}
            onClick={() => setPanel(panel === "request" ? null : "request")}
            label="İptal/değişiklik talebi oluştur"
          />
        )}
      </div>

      {panel === "cancel" && (
        <form
          action={cancelSession}
          className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3"
        >
          <input type="hidden" name="lessonSessionId" value={sessionId} />
          <input type="hidden" name="date" value={date} />

          <label className="text-xs font-medium text-text-secondary">
            İptal gerekçesi
            <input
              name="reason"
              required
              minLength={3}
              placeholder="ör. öğretmen raporlu"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="text-xs font-medium text-text-secondary">
            İptal türü
            <select
              name="cancellationKind"
              defaultValue="institution"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="institution">Kurum kaynaklı (öğretmen hakedişini etkilemez)</option>
              <option value="teacher_absence">Öğretmen devamsızlığı (hakediş oluşmaz)</option>
            </select>
          </label>

          <button
            type="submit"
            className="self-end rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-danger/90"
          >
            Oturumu iptal et
          </button>
        </form>
      )}

      {panel === "reschedule" && (
        <RescheduleForm
          action={rescheduleSession}
          sessionId={sessionId}
          date={date}
          submitLabel="Yeniden planla"
        />
      )}

      {panel === "request" && <RequestForm sessionId={sessionId} date={date} />}
    </div>
  );
}

function RescheduleForm({
  action,
  sessionId,
  date,
  submitLabel,
}: {
  action: (formData: FormData) => void;
  sessionId: string;
  date: string;
  submitLabel: string;
}) {
  return (
    <form
      action={action}
      className="mt-3 grid gap-2 rounded-xl border border-border bg-surface-muted p-3 sm:grid-cols-2"
    >
      <input type="hidden" name="lessonSessionId" value={sessionId} />
      <input type="hidden" name="date" value={date} />

      <label className="text-xs font-medium text-text-secondary sm:col-span-2">
        Gerekçe
        <input
          name="reason"
          required
          minLength={3}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <label className="text-xs font-medium text-text-secondary">
        Yeni tarih
        <input
          type="date"
          name="newDate"
          required
          defaultValue={date}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-text-secondary">
          Başlangıç
          <input
            type="time"
            name="newStartTime"
            required
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>

        <label className="text-xs font-medium text-text-secondary">
          Bitiş
          <input
            type="time"
            name="newEndTime"
            required
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </label>
      </div>

      <button
        type="submit"
        className="self-end rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-hover sm:col-span-2 sm:w-fit sm:justify-self-end"
      >
        {submitLabel}
      </button>
    </form>
  );
}

function RequestForm({ sessionId, date }: { sessionId: string; date: string }) {
  const [requestType, setRequestType] = useState<"cancel" | "reschedule">("cancel");

  return (
    <form
      action={requestSessionChange}
      className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-surface-muted p-3"
    >
      <input type="hidden" name="lessonSessionId" value={sessionId} />
      <input type="hidden" name="date" value={date} />

      <label className="text-xs font-medium text-text-secondary">
        Talep türü
        <select
          name="requestType"
          value={requestType}
          onChange={(event) => setRequestType(event.target.value as "cancel" | "reschedule")}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        >
          <option value="cancel">İptal talebi</option>
          <option value="reschedule">Yeniden planlama talebi</option>
        </select>
      </label>

      <label className="text-xs font-medium text-text-secondary">
        Gerekçe
        <input
          name="reason"
          required
          minLength={3}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      {requestType === "reschedule" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs font-medium text-text-secondary">
            Önerilen tarih
            <input
              type="date"
              name="proposedDate"
              required
              defaultValue={date}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="text-xs font-medium text-text-secondary">
            Başlangıç
            <input
              type="time"
              name="proposedStartTime"
              required
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>

          <label className="text-xs font-medium text-text-secondary">
            Bitiş
            <input
              type="time"
              name="proposedEndTime"
              required
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </label>
        </div>
      )}

      <button
        type="submit"
        className="self-end rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-hover"
      >
        Talebi gönder
      </button>
    </form>
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
          ? "border-primary-soft bg-primary-soft text-primary dark:bg-primary/10"
          : "border-border text-text-secondary hover:bg-surface-muted"
      }`}
    >
      {label}
    </button>
  );
}
