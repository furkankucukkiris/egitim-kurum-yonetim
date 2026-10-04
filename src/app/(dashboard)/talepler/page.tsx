import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RequestCard, type RequestItem } from "@/components/talepler/RequestCard";
import { SubmitButton } from "@/components/submit-button";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { createTeacherRequest } from "./actions";

type PageProps = {
  searchParams: Promise<{
    durum?: string;
    seans?: string;
    success?: string;
    error?: string;
  }>;
};

type Filter = "acik" | "kapanan" | "tumu";

const filters: { value: Filter; label: string }[] = [
  { value: "acik", label: "Açık" },
  { value: "kapanan", label: "Kapanan" },
  { value: "tumu", label: "Tümü" },
];

const LIST_LIMIT = 100;

type RequestRow = {
  id: string;
  teacher_profile_id: string;
  student_id: string | null;
  lesson_session_id: string | null;
  body: string;
  status: "open" | "resolved";
  resolved_at: string | null;
  admin_activity_at: string | null;
  teacher_seen_at: string | null;
  created_at: string;
  teacher: { full_name: string } | null;
  student: { first_name: string; last_name: string } | null;
  session: { starts_at: string; course: { name: string } | null } | null;
  replies: {
    id: string;
    author_profile_id: string;
    body: string;
    created_at: string;
  }[];
};

// get_teacher_enrollments() satırının bu sayfada kullanılan kısmı.
type TeacherEnrollmentRpcRow = {
  student_id: string;
  student_first_name: string;
  student_last_name: string;
};

const requestSelect = `
  id,
  teacher_profile_id,
  student_id,
  lesson_session_id,
  body,
  status,
  resolved_at,
  admin_activity_at,
  teacher_seen_at,
  created_at,
  teacher:profiles!teacher_requests_teacher_profile_id_fkey ( full_name ),
  student:students ( first_name, last_name ),
  session:lesson_sessions ( starts_at, course:courses ( name ) ),
  replies:teacher_request_replies ( id, author_profile_id, body, created_at )
`;

export default async function TeacherRequestsPage({ searchParams }: PageProps) {
  const profile = await requireRole(["admin", "teacher"]);
  const params = await searchParams;
  const isAdmin = profile.role === "admin";

  const filter: Filter = filters.some((item) => item.value === params.durum)
    ? (params.durum as Filter)
    : isAdmin
      ? "acik"
      : "tumu";
  const sessionFilter = params.seans?.trim() || null;

  const supabase = await createClient();

  let listQuery = supabase
    .from("teacher_requests")
    .select(requestSelect)
    .order("created_at", { ascending: false })
    .order("created_at", { referencedTable: "teacher_request_replies", ascending: true })
    .limit(LIST_LIMIT);

  if (filter === "acik") listQuery = listQuery.eq("status", "open");
  if (filter === "kapanan") listQuery = listQuery.eq("status", "resolved");
  if (sessionFilter) listQuery = listQuery.eq("lesson_session_id", sessionFilter);

  const countQuery = (status: "open" | "resolved") => {
    let query = supabase
      .from("teacher_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (sessionFilter) query = query.eq("lesson_session_id", sessionFilter);

    return query;
  };

  const [listResult, openCountResult, resolvedCountResult, enrollmentsResult, sessionResult] =
    await Promise.all([
      listQuery,
      countQuery("open"),
      countQuery("resolved"),
      isAdmin
        ? Promise.resolve(null)
        : supabase.rpc("get_teacher_enrollments").in("status", ["active", "frozen"]),
      sessionFilter
        ? supabase
            .from("lesson_sessions")
            .select("id, starts_at, course:courses ( name )")
            .eq("id", sessionFilter)
            .maybeSingle()
        : Promise.resolve(null),
    ]);

  if (listResult.error) {
    console.error("Notlar ve talepler alınamadı:", listResult.error);
  }

  if (enrollmentsResult?.error) {
    console.error("Öğretmen öğrencileri alınamadı:", enrollmentsResult.error);
  }

  const rows = (listResult.data ?? []) as unknown as RequestRow[];

  // Öğretmen students tablosunu doğrudan göremez (RLS); öğrenci adları
  // kendi kayıtlarından gelir.
  const teacherStudents = new Map<string, string>();

  for (const row of (enrollmentsResult?.data ?? []) as TeacherEnrollmentRpcRow[]) {
    teacherStudents.set(row.student_id, `${row.student_first_name} ${row.student_last_name}`);
  }

  const studentOptions = Array.from(teacherStudents, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name, "tr-TR"),
  );

  const linkedSession = sessionResult?.data as unknown as {
    id: string;
    starts_at: string;
    course: { name: string } | null;
  } | null;

  const items: RequestItem[] = rows.map((row) => ({
    id: row.id,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    teacherProfileId: row.teacher_profile_id,
    teacherName: row.teacher?.full_name ?? "Öğretmen",
    studentName: row.student
      ? `${row.student.first_name} ${row.student.last_name}`
      : row.student_id
        ? (teacherStudents.get(row.student_id) ?? null)
        : null,
    sessionLabel: row.session ? formatSessionLabel(row.session) : null,
    hasUnseenReply:
      !isAdmin &&
      row.admin_activity_at !== null &&
      (row.teacher_seen_at === null ||
        Date.parse(row.admin_activity_at) > Date.parse(row.teacher_seen_at)),
    replies: row.replies,
  }));

  // Liste okunduktan sonra işaretlenir; böylece "Yeni yanıt" rozeti bu
  // gösterimde kalır, menüdeki sayaç bir sonraki sayfada sıfırlanır.
  if (!isAdmin && items.some((item) => item.hasUnseenReply)) {
    const { error } = await supabase.rpc("mark_teacher_requests_seen");

    if (error) {
      console.error("Yanıtlar görüldü olarak işaretlenemedi:", error);
    }
  }

  const counts: Record<Filter, number> = {
    acik: openCountResult.count ?? 0,
    kapanan: resolvedCountResult.count ?? 0,
    tumu: (openCountResult.count ?? 0) + (resolvedCountResult.count ?? 0),
  };

  const filterHref = (value: Filter) => {
    const query = new URLSearchParams({ durum: value });
    if (sessionFilter) query.set("seans", sessionFilter);
    return `/talepler?${query.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Notlar & Talepler"
        description={
          isAdmin
            ? "Öğretmenlerin ilettiği notlar ve talepler. Yanıt yazın, iş tamamlanınca konuyu kapatın."
            : "Yöneticiye not veya talep iletin (ör. malzeme ihtiyacı, öğrenciyle ilgili bilgi). Yanıtlar burada görünür."
        }
      />

      {params.success && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {params.success}
        </div>
      )}

      {params.error && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {params.error}
        </div>
      )}

      {!isAdmin && (
        <form
          action={createTeacherRequest}
          className="mb-6 rounded-2xl border border-border bg-surface p-5"
        >
          <input type="hidden" name="filter" value={filter} />
          {linkedSession && (
            <>
              <input type="hidden" name="lessonSessionId" value={linkedSession.id} />
              <input type="hidden" name="returnSession" value={linkedSession.id} />
            </>
          )}

          <h3 className="font-semibold text-text-primary">Yeni not / talep</h3>

          {linkedSession && (
            <p className="mt-2 text-sm text-text-secondary">
              Bu not şu derse bağlanacak:{" "}
              <span className="font-medium text-text-primary">
                {formatSessionLabel(linkedSession)}
              </span>{" "}
              <Link href="/talepler" className="text-primary hover:underline">
                (bağlantıyı kaldır)
              </Link>
            </p>
          )}

          <textarea
            name="body"
            required
            rows={3}
            maxLength={2000}
            placeholder="Ör. Ayşe Kaya için 30x40 tuval alınması gerekiyor."
            className="mt-3 w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
          />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <label className="flex flex-col gap-1 text-sm text-text-secondary">
              İlgili öğrenci (isteğe bağlı)
              <select
                name="studentId"
                defaultValue=""
                className="min-w-64 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
              >
                <option value="">Öğrenci seçilmedi</option>
                {studentOptions.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            </label>

            <SubmitButton pendingText="Gönderiliyor...">Yöneticiye gönder</SubmitButton>
          </div>
        </form>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {filters.map((item) => (
          <Link
            key={item.value}
            href={filterHref(item.value)}
            aria-current={filter === item.value ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              filter === item.value
                ? "border-primary bg-primary text-on-primary"
                : "border-border bg-surface text-text-secondary hover:bg-surface-hover",
            )}
          >
            {item.label} ({counts[item.value]})
          </Link>
        ))}

        {sessionFilter && (
          <Link
            href={`/talepler?durum=${filter}`}
            className="ml-auto text-sm text-primary hover:underline"
          >
            {linkedSession ? `${formatSessionLabel(linkedSession)} · ` : ""}Ders filtresini kaldır
          </Link>
        )}
      </div>

      {listResult.error ? (
        <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Notlar ve talepler alınamadı.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-text-secondary">
          {filter === "acik" ? "Açık not veya talep yok." : "Kayıt bulunamadı."}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <RequestCard
              key={item.id}
              item={item}
              isAdmin={isAdmin}
              filter={filter}
              returnSession={sessionFilter}
            />
          ))}

          {items.length === LIST_LIMIT && (
            <p className="text-center text-xs text-text-secondary">
              En yeni {LIST_LIMIT} kayıt gösteriliyor.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function formatSessionLabel(session: { starts_at: string; course: { name: string } | null }) {
  const when = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "long",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(session.starts_at));

  return `${session.course?.name ?? "Ders"} · ${when}`;
}
