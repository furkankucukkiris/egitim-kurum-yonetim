import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SessionComments, type SessionComment } from "@/components/yoklama/SessionComments";
import { AttendanceRoster, type RosterStudent } from "@/components/yoklama/AttendanceRoster";
import { SessionActions } from "@/components/yoklama/SessionActions";
import {
  MakeupCreditItem,
  type PendingCredit,
  type UpcomingSessionOption,
  type TeacherOption,
} from "@/components/yoklama/MakeupCreditItem";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateMonthlySessions } from "./actions";
import { reviewSessionChangeRequest } from "./session-actions";

type PageProps = {
  searchParams: Promise<{
    date?: string;
    success?: string;
    error?: string;
  }>;
};

type SessionRow = {
  id: string;
  class_group_id: string | null;
  teacher_profile_id: string | null;
  starts_at: string;
  ends_at: string;
  room_name: string | null;
  is_makeup: boolean;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  teacher_confirmed_at: string | null;
  attendance_locked_at: string | null;
  course: {
    name: string;
    course_type: "individual" | "group";
  } | null;
  class_group: {
    name: string;
  } | null;
  teacher: {
    full_name: string;
  } | null;
  locker: {
    full_name: string;
  } | null;
};

type RosterRow = {
  lesson_session_id: string;
  student_id: string;
  student_first_name: string;
  student_last_name: string;
  status: RosterStudent["status"];
  note: string | null;
  notified_at: string | null;
  is_makeup_guest: boolean;
};

type ChangeRequestRow = {
  id: string;
  lesson_session_id: string;
  request_type: "cancel" | "reschedule";
};

type PendingCreditRpcRow = {
  credit_id: string;
  student_full_name: string;
  course_id: string;
  course_name: string;
  reason: PendingCredit["reason"];
  source_starts_at: string;
  expires_at: string | null;
};

type PendingRequestRpcRow = {
  request_id: string;
  lesson_session_id: string;
  request_type: "cancel" | "reschedule";
  reason: string;
  proposed_starts_at: string | null;
  proposed_ends_at: string | null;
  requested_by_name: string;
  session_starts_at: string;
  course_name: string;
  class_group_name: string | null;
};

type UpcomingSessionRow = {
  id: string;
  course_id: string;
  starts_at: string;
  class_group: { name: string } | null;
  teacher: { full_name: string } | null;
};

type UnmarkedSessionRow = {
  lesson_session_id: string;
  starts_at: string;
  course_name: string;
  class_group_name: string | null;
  teacher_full_name: string | null;
};

type EnrollmentRow = {
  student_id: string;
  class_group_id: string | null;
  starts_on: string;
  ends_on: string | null;
};

type CommentRow = {
  id: string;
  lesson_session_id: string;
  body: string;
  created_at: string;
  author: { full_name: string; role: string } | null;
};

export default async function AttendancePage({ searchParams }: PageProps) {
  const profile = await requireRole(["admin", "teacher"]);

  const params = await searchParams;

  const today = getTodayInIstanbul();

  const selectedDate = isIsoDate(params.date) ? params.date : today;

  const previousDate = addDays(selectedDate, -1);

  const nextDate = addDays(selectedDate, 1);

  const supabase = await createClient();

  let sessionsQuery = supabase
    .from("lesson_sessions")
    .select(
      `
        id,
        class_group_id,
        teacher_profile_id,
        starts_at,
        ends_at,
        room_name,
        is_makeup,
        cancelled_at,
        cancellation_reason,
        teacher_confirmed_at,
        attendance_locked_at,
        course:courses (
          name,
          course_type
        ),
        class_group:class_groups (
          name
        ),
        teacher:profiles!teacher_profile_id (
          full_name
        ),
        locker:profiles!attendance_locked_by (
          full_name
        )
      `,
    )
    .eq("is_trial", false)
    .gte("starts_at", `${selectedDate}T00:00:00+03:00`)
    .lt("starts_at", `${nextDate}T00:00:00+03:00`)
    .order("starts_at");

  if (profile.role === "teacher") {
    sessionsQuery = sessionsQuery.eq("teacher_profile_id", profile.id);
  }

  const sessionsResult = await sessionsQuery;

  if (sessionsResult.error) {
    console.error("Ders oturumları alınamadı:", sessionsResult.error);
  }

  const sessions = (sessionsResult.data ?? []) as unknown as SessionRow[];

  const classGroupIds = Array.from(
    new Set(
      sessions
        .map((session) => session.class_group_id)
        .filter((groupId): groupId is string => Boolean(groupId)),
    ),
  );

  let enrollments: EnrollmentRow[] = [];
  let enrollmentsError = false;

  if (classGroupIds.length > 0) {
    // Teacher, enrollments tablosuna doğrudan erişemez (ücret/indirim
    // sütunları içerdiği için); kendi kayıtlarını yalnızca finansal
    // olmayan alanları döndüren get_teacher_enrollments() RPC'siyle
    // görür. Admin tabloyu doğrudan sorgulamaya devam eder.
    const result =
      profile.role === "teacher"
        ? await supabase
            .rpc("get_teacher_enrollments")
            .eq("status", "active")
            .in("class_group_id", classGroupIds)
        : await supabase
            .from("enrollments")
            .select(
              `
                student_id,
                class_group_id,
                starts_on,
                ends_on
              `,
            )
            .eq("status", "active")
            .in("class_group_id", classGroupIds);

    if (result.error) {
      console.error("Oturum öğrenci sayıları alınamadı:", result.error);

      enrollmentsError = true;
    }

    enrollments = ((result.data ?? []) as unknown as EnrollmentRow[]).map((row) => ({
      student_id: row.student_id,
      class_group_id: row.class_group_id,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
    }));
  }

  const sessionIds = sessions.map((session) => session.id);
  const commentsBySession = new Map<string, SessionComment[]>();

  if (sessionIds.length > 0) {
    const commentsResult = await supabase
      .from("lesson_session_comments")
      .select(
        `
          id,
          lesson_session_id,
          body,
          created_at,
          author:profiles ( full_name, role )
        `,
      )
      .in("lesson_session_id", sessionIds)
      .order("created_at", { ascending: true });

    if (commentsResult.error) {
      console.error("Oturum yorumları alınamadı:", commentsResult.error);
    }

    const comments = (commentsResult.data ?? []) as unknown as CommentRow[];

    for (const comment of comments) {
      const list = commentsBySession.get(comment.lesson_session_id) ?? [];

      list.push({
        id: comment.id,
        body: comment.body,
        createdAt: comment.created_at,
        authorName: comment.author?.full_name ?? "Bilinmiyor",
        authorRole: comment.author?.role ?? "",
      });

      commentsBySession.set(comment.lesson_session_id, list);
    }
  }

  const rosterBySession = new Map<string, RosterStudent[]>();

  if (sessionIds.length > 0) {
    const rosterResult = await supabase.rpc("get_attendance_roster", {
      p_lesson_session_ids: sessionIds,
    });

    if (rosterResult.error) {
      console.error("Yoklama listesi alınamadı:", rosterResult.error);
    }

    const rosterRows = (rosterResult.data ?? []) as unknown as RosterRow[];

    for (const row of rosterRows) {
      const list = rosterBySession.get(row.lesson_session_id) ?? [];

      list.push({
        studentId: row.student_id,
        firstName: row.student_first_name,
        lastName: row.student_last_name,
        status: row.status,
        note: row.note,
        notifiedAt: row.notified_at,
        isMakeupGuest: row.is_makeup_guest,
      });

      rosterBySession.set(row.lesson_session_id, list);
    }
  }

  const pendingRequestBySession = new Map<string, "cancel" | "reschedule">();

  if (sessionIds.length > 0) {
    const changeRequestsResult = await supabase
      .from("session_change_requests")
      .select("id, lesson_session_id, request_type")
      .in("lesson_session_id", sessionIds)
      .eq("status", "pending");

    if (changeRequestsResult.error) {
      console.error("Bekleyen değişiklik talepleri alınamadı:", changeRequestsResult.error);
    }

    const changeRequests = (changeRequestsResult.data ?? []) as unknown as ChangeRequestRow[];

    for (const request of changeRequests) {
      pendingRequestBySession.set(request.lesson_session_id, request.request_type);
    }
  }

  let unmarkedSessions: UnmarkedSessionRow[] = [];
  let pendingCredits: PendingCredit[] = [];
  let pendingRequests: PendingRequestRpcRow[] = [];
  const upcomingSessionsByCourse = new Map<string, UpcomingSessionOption[]>();
  let teachers: TeacherOption[] = [];

  if (profile.role === "admin") {
    const unmarkedResult = await supabase.rpc("get_unmarked_past_sessions", {
      p_limit: 10,
    });

    if (unmarkedResult.error) {
      console.error("Yoklaması alınmamış geçmiş oturumlar alınamadı:", unmarkedResult.error);
    }

    unmarkedSessions = (unmarkedResult.data ?? []) as unknown as UnmarkedSessionRow[];

    const [creditsResult, requestsResult] = await Promise.all([
      supabase.rpc("get_pending_makeup_credits", { p_limit: 20 }),
      supabase.rpc("get_pending_session_change_requests"),
    ]);

    if (creditsResult.error) {
      console.error("Bekleyen telafi hakları alınamadı:", creditsResult.error);
    }

    if (requestsResult.error) {
      console.error("Bekleyen değişiklik talepleri alınamadı:", requestsResult.error);
    }

    const creditRows = (creditsResult.data ?? []) as unknown as PendingCreditRpcRow[];

    pendingCredits = creditRows.map((row) => ({
      creditId: row.credit_id,
      studentFullName: row.student_full_name,
      courseId: row.course_id,
      courseName: row.course_name,
      reason: row.reason,
      sourceStartsAt: row.source_starts_at,
      expiresAt: row.expires_at,
    }));

    pendingRequests = (requestsResult.data ?? []) as unknown as PendingRequestRpcRow[];

    const courseIds = Array.from(new Set(pendingCredits.map((credit) => credit.courseId)));

    if (courseIds.length > 0) {
      const upcomingResult = await supabase
        .from("lesson_sessions")
        .select(
          `
            id,
            course_id,
            starts_at,
            class_group:class_groups ( name ),
            teacher:profiles!teacher_profile_id ( full_name )
          `,
        )
        .in("course_id", courseIds)
        .eq("is_trial", false)
        .is("cancelled_at", null)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(50);

      if (upcomingResult.error) {
        console.error("Yaklaşan oturumlar alınamadı:", upcomingResult.error);
      }

      const upcomingRows = (upcomingResult.data ?? []) as unknown as UpcomingSessionRow[];

      for (const row of upcomingRows) {
        const list = upcomingSessionsByCourse.get(row.course_id) ?? [];

        list.push({
          id: row.id,
          startsAt: row.starts_at,
          className: row.class_group?.name ?? null,
          teacherName: row.teacher?.full_name ?? null,
        });

        upcomingSessionsByCourse.set(row.course_id, list);
      }
    }

    const teachersResult = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "teacher")
      .eq("is_active", true)
      .order("full_name");

    if (teachersResult.error) {
      console.error("Öğretmen listesi alınamadı:", teachersResult.error);
    }

    teachers = (teachersResult.data ?? []) as unknown as TeacherOption[];
  }

  const enrollmentCountByGroup = new Map<string, number>();

  for (const enrollment of enrollments) {
    if (
      !enrollment.class_group_id ||
      enrollment.starts_on > selectedDate ||
      (enrollment.ends_on && enrollment.ends_on < selectedDate)
    ) {
      continue;
    }

    enrollmentCountByGroup.set(
      enrollment.class_group_id,
      (enrollmentCountByGroup.get(enrollment.class_group_id) ?? 0) + 1,
    );
  }

  const cancelledCount = sessions.filter((session) => Boolean(session.cancelled_at)).length;

  const totalStudentCount = sessions.reduce(
    (total, session) =>
      total +
      (session.class_group_id ? (enrollmentCountByGroup.get(session.class_group_id) ?? 0) : 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Gerçek Ders Oturumları"
        description={
          profile.role === "teacher"
            ? "Yalnızca size atanmış gerçek ders oturumlarını ve kalıcı öğrenci sayılarını görüntülüyorsunuz."
            : "Haftalık programlardan gerçek aylık ders oturumlarını oluşturun ve günlük akışı yönetin."
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

      {profile.role === "admin" && unmarkedSessions.length > 0 && (
        <section className="mb-6 rounded-2xl border border-accent/30 bg-accent-soft p-5 shadow-sm border-accent/40 bg-accent-soft">
          <h2 className="font-bold text-accent-strong">
            Yoklaması alınmamış geçmiş dersler
          </h2>

          <p className="mt-1 text-sm text-accent-strong text-accent-strong">
            Bu oturumlar için henüz hiç yoklama girilmemiş.
          </p>

          <ul className="mt-3 space-y-2">
            {unmarkedSessions.map((session) => (
              <li key={session.lesson_session_id}>
                <Link
                  href={`/yoklama?date=${session.starts_at.slice(0, 10)}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-4 py-2.5 text-sm shadow-sm hover:bg-surface-muted"
                >
                  <span className="font-semibold text-text-primary">
                    {session.course_name}
                    {session.class_group_name ? ` — ${session.class_group_name}` : ""}
                  </span>

                  <span className="text-text-secondary">
                    {formatLongDate(session.starts_at.slice(0, 10))} ·{" "}
                    {session.teacher_full_name ?? "Atanmamış"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.role === "admin" && pendingRequests.length > 0 && (
        <section className="mb-6 rounded-2xl border border-info/30 bg-info-soft p-5 shadow-sm border-info/30 bg-info-soft">
          <h2 className="font-bold text-info text-info">Bekleyen iptal/değişiklik talepleri</h2>

          <ul className="mt-3 space-y-3">
            {pendingRequests.map((request) => (
              <li key={request.request_id} className="rounded-xl bg-surface p-3 shadow-sm">
                <p className="text-sm font-semibold text-text-primary">
                  {request.requested_by_name} —{" "}
                  {request.request_type === "cancel" ? "İptal talebi" : "Yeniden planlama talebi"}
                </p>

                <p className="mt-1 text-xs text-text-secondary">
                  {request.course_name}
                  {request.class_group_name ? ` — ${request.class_group_name}` : ""} ·{" "}
                  {formatDateTime(request.session_starts_at)}
                </p>

                <p className="mt-1.5 text-sm text-text-primary">{request.reason}</p>

                {request.request_type === "reschedule" && request.proposed_starts_at && (
                  <p className="mt-1 text-xs text-text-secondary">
                    Önerilen: {formatDateTime(request.proposed_starts_at)} –{" "}
                    {request.proposed_ends_at ? formatDateTime(request.proposed_ends_at) : ""}
                  </p>
                )}

                <div className="mt-2.5 flex gap-2">
                  <form action={reviewSessionChangeRequest}>
                    <input type="hidden" name="requestId" value={request.request_id} />
                    <input type="hidden" name="date" value={selectedDate} />
                    <input type="hidden" name="approve" value="true" />

                    <button
                      type="submit"
                      className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary shadow-sm hover:bg-primary-hover"
                    >
                      Onayla
                    </button>
                  </form>

                  <form action={reviewSessionChangeRequest}>
                    <input type="hidden" name="requestId" value={request.request_id} />
                    <input type="hidden" name="date" value={selectedDate} />
                    <input type="hidden" name="approve" value="false" />

                    <button
                      type="submit"
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-muted"
                    >
                      Reddet
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {profile.role === "admin" && pendingCredits.length > 0 && (
        <section className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="font-bold text-text-primary">Bekleyen telafi hakları</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Kurum kaynaklı iptal veya öğrenci devamsızlığından doğan, henüz planlanmamış telafi
            hakları.
          </p>

          <ul className="mt-3 space-y-3">
            {pendingCredits.map((credit) => (
              <MakeupCreditItem
                key={credit.creditId}
                credit={credit}
                date={selectedDate}
                sessionsForCourse={upcomingSessionsByCourse.get(credit.courseId) ?? []}
                teachers={teachers}
              />
            ))}
          </ul>
        </section>
      )}

      {profile.role === "admin" && (
        <section className="mb-6 rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h2 className="font-bold">Aylık oturumları oluştur</h2>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
                Aktif programların haftalık gün ve saatlerinden seçilen ayın gerçek oturumları
                oluşturulur. Aynı işlem tekrar çalıştırılırsa mevcut oturumlar çoğaltılmaz.
              </p>
            </div>

            <form
              action={generateMonthlySessions}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <label className="block text-sm font-medium">
                Oluşturulacak ay
                <input
                  type="month"
                  name="month"
                  required
                  defaultValue={selectedDate.slice(0, 7)}
                  className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm"
                />
              </label>

              <button
                type="submit"
                className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary"
              >
                Ayın oturumlarını oluştur
              </button>
            </form>
          </div>
        </section>
      )}

      {profile.role === "teacher" && (
        <div className="mb-6 rounded-2xl border border-info/30 border-info/30 bg-info-soft p-4 text-sm leading-6 text-info text-info">
          Aylık oturumları yönetici oluşturur. Size atanmış oturumlar oluşturulduğu anda bu ekranda
          görünür.
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-sm">
        <form method="get" className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <Link
            href={`/yoklama?date=${previousDate}`}
            className="rounded-xl border border-border bg-surface px-4 py-3 text-center text-sm font-semibold text-primary"
          >
            ← Önceki gün
          </Link>

          <label className="block text-sm font-medium">
            Görüntülenecek tarih
            <input
              type="date"
              name="date"
              required
              defaultValue={selectedDate}
              className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary"
          >
            Tarihe git
          </button>
        </form>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Link
            href={`/yoklama?date=${today}`}
            className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-center text-sm font-semibold text-accent-strong"
          >
            Bugüne dön
          </Link>

          <Link
            href={`/yoklama?date=${nextDate}`}
            className="rounded-xl border border-border bg-surface px-4 py-2.5 text-center text-sm font-semibold text-primary"
          >
            Sonraki gün →
          </Link>
        </div>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Ders oturumu" value={sessions.length} />

        <SummaryCard label="Kalıcı öğrenci" value={totalStudentCount} />

        <SummaryCard label="İptal edilen" value={cancelledCount} />
      </section>

      <div className="mb-4">
        <h2 className="text-xl font-bold">{formatLongDate(selectedDate)}</h2>

        <p className="mt-1 text-sm text-text-secondary">
          {selectedDate === today
            ? "Bugünün gerçek ders akışı"
            : "Seçilen tarihin gerçek ders akışı"}
        </p>
      </div>

      {(sessionsResult.error || enrollmentsError) && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Oturum verilerinin bir kısmı alınamadı.
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-surface-muted text-2xl">
            ◫
          </div>

          <h3 className="mt-5 text-lg font-bold">Bu tarihte ders oturumu yok</h3>

          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-text-secondary">
            {profile.role === "admin"
              ? "Seçilen ayın oturumları henüz oluşturulmadıysa yukarıdaki bölümden oluşturun. Programda o güne ait ders yoksa farklı bir tarih seçin."
              : "Yöneticinin oluşturduğu ve size atanmış bir oturum bulunmuyor. Farklı bir tarih seçebilirsiniz."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sessions.map((session) => {
            const studentCount = session.class_group_id
              ? (enrollmentCountByGroup.get(session.class_group_id) ?? 0)
              : 0;

            return (
              <article
                key={session.id}
                className={`rounded-2xl border bg-surface p-5 shadow-sm ${
                  session.cancelled_at ? "border-danger/30 bg-danger-soft/30" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-accent-strong">
                      {formatTime(session.starts_at)} – {formatTime(session.ends_at)}
                    </p>

                    <h3 className="mt-1 text-lg font-bold">
                      {session.course?.name ?? "Ders bilgisi yok"}
                    </h3>

                    <p className="mt-1 text-sm text-text-secondary">
                      {session.class_group?.name ?? "Program bilgisi yok"}
                    </p>
                  </div>

                  <SessionBadge session={session} />
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Öğretmen</dt>
                    <dd className="mt-1 font-semibold">
                      {session.teacher?.full_name ?? "Atanmamış"}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Derslik</dt>
                    <dd className="mt-1 font-semibold">{session.room_name ?? "Belirtilmedi"}</dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Kalıcı öğrenci</dt>
                    <dd className="mt-1 font-semibold">{studentCount}</dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Öğretmen onayı</dt>
                    <dd className="mt-1 font-semibold">
                      {session.teacher_confirmed_at ? "Onaylandı" : "Bekliyor"}
                    </dd>
                  </div>
                </dl>

                {session.cancelled_at && session.cancellation_reason && (
                  <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
                    İptal nedeni: {session.cancellation_reason}
                  </div>
                )}

                <AttendanceRoster
                  sessionId={session.id}
                  date={selectedDate}
                  students={rosterBySession.get(session.id) ?? []}
                  locked={Boolean(session.attendance_locked_at)}
                  lockedByName={session.locker?.full_name ?? null}
                  canMark={
                    !session.cancelled_at &&
                    (profile.role === "admin" || session.teacher_profile_id === profile.id)
                  }
                  isAdmin={profile.role === "admin"}
                />

                {!session.cancelled_at && (
                  <SessionActions
                    sessionId={session.id}
                    date={selectedDate}
                    isAdmin={profile.role === "admin"}
                    canRequest={
                      profile.role === "teacher" && session.teacher_profile_id === profile.id
                    }
                    pendingRequestType={pendingRequestBySession.get(session.id) ?? null}
                  />
                )}

                <SessionComments
                  sessionId={session.id}
                  date={selectedDate}
                  comments={commentsBySession.get(session.id) ?? []}
                  canComment={profile.role === "admin" || session.teacher_profile_id === profile.id}
                  canDelete={profile.role === "admin"}
                />
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-sm text-text-secondary">{label}</p>

      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function SessionBadge({ session }: { session: SessionRow }) {
  if (session.cancelled_at) {
    return (
      <span className="rounded-full bg-danger-soft px-3 py-1 text-xs font-bold text-danger text-danger">
        İptal
      </span>
    );
  }

  if (session.is_makeup) {
    return (
      <span className="rounded-full bg-info-soft px-3 py-1 text-xs font-bold text-info text-info">
        TELAFİ
      </span>
    );
  }

  return (
    <span className="rounded-full bg-success-soft px-3 py-1 text-xs font-bold text-success text-success">
      Planlandı
    </span>
  );
}

function getTodayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + amount);

  return date.toISOString().slice(0, 10);
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00+03:00`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
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
