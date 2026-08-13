import { Card } from "../ui/Card";
import { StatusBadge, type BadgeTone } from "../ui/StatusBadge";

interface SessionItem {
  time: string;
  course: string;
  teacher: string;
  room: string;
  status: string;
}

interface TodaySessionsListProps {
  sessions: SessionItem[];
}

const statusTone: Record<string, BadgeTone> = {
  Planlandı: "success",
  Telafi: "neutral",
  Deneme: "warning",
  İptal: "danger",
};

export function TodaySessionsList({ sessions }: TodaySessionsListProps) {
  if (sessions.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-text-secondary">
        Bugün için planlanmış bir ders oturumu yok.
      </Card>
    );
  }

  return (
    <div className="space-y-2.5">
      {sessions.map((session, index) => (
        <Card
          key={`${session.time}-${session.course}-${index}`}
          className="flex items-center justify-between gap-4 p-3.5"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 shrink-0 text-sm font-semibold text-primary text-primary">
              {session.time}
            </div>

            <div>
              <p className="text-sm font-medium text-text-primary">{session.course}</p>
              <p className="mt-0.5 text-xs text-text-secondary">
                {session.teacher} · {session.room}
              </p>
            </div>
          </div>

          <StatusBadge label={session.status} tone={statusTone[session.status] ?? "neutral"} />
        </Card>
      ))}
    </div>
  );
}
