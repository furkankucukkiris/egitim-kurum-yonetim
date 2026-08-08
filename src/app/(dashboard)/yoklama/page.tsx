import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SessionComments, type SessionComment } from "@/components/yoklama/SessionComments";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  generateMonthlySessions,
} from "./actions";

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
  course: {
    name: string;
    course_type:
      | "individual"
      | "group";
  } | null;
  class_group: {
    name: string;
  } | null;
  teacher: {
    full_name: string;
  } | null;
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

export default async function AttendancePage({
  searchParams,
}: PageProps) {
  const profile = await requireRole([
    "admin",
    "teacher",
  ]);

  const params = await searchParams;

  const today = getTodayInIstanbul();

  const selectedDate = isIsoDate(
    params.date,
  )
    ? params.date
    : today;

  const previousDate = addDays(
    selectedDate,
    -1,
  );

  const nextDate = addDays(
    selectedDate,
    1,
  );

  const supabase = await createClient();

  let sessionsQuery = supabase
    .from("lesson_sessions")
    .select(`
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
      course:courses (
        name,
        course_type
      ),
      class_group:class_groups (
        name
      ),
      teacher:profiles (
        full_name
      )
    `)
    .gte(
      "starts_at",
      `${selectedDate}T00:00:00+03:00`,
    )
    .lt(
      "starts_at",
      `${nextDate}T00:00:00+03:00`,
    )
    .order("starts_at");

  if (profile.role === "teacher") {
    sessionsQuery = sessionsQuery.eq(
      "teacher_profile_id",
      profile.id,
    );
  }

  const sessionsResult =
    await sessionsQuery;

  if (sessionsResult.error) {
    console.error(
      "Ders oturumları alınamadı:",
      sessionsResult.error,
    );
  }

  const sessions =
    (sessionsResult.data ??
      []) as unknown as SessionRow[];

  const classGroupIds = Array.from(
    new Set(
      sessions
        .map(
          (session) =>
            session.class_group_id,
        )
        .filter(
          (
            groupId,
          ): groupId is string =>
            Boolean(groupId),
        ),
    ),
  );

  let enrollments: EnrollmentRow[] = [];
  let enrollmentsError = false;

  if (classGroupIds.length > 0) {
    const result = await supabase
      .from("enrollments")
      .select(`
        student_id,
        class_group_id,
        starts_on,
        ends_on
      `)
      .eq("status", "active")
      .in(
        "class_group_id",
        classGroupIds,
      );

    if (result.error) {
      console.error(
        "Oturum öğrenci sayıları alınamadı:",
        result.error,
      );

      enrollmentsError = true;
    }

    enrollments =
      (result.data ??
        []) as EnrollmentRow[];
  }

  const sessionIds = sessions.map((session) => session.id);
  const commentsBySession = new Map<string, SessionComment[]>();

  if (sessionIds.length > 0) {
    const commentsResult = await supabase
      .from("lesson_session_comments")
      .select(`
        id,
        lesson_session_id,
        body,
        created_at,
        author:profiles ( full_name, role )
      `)
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

  const enrollmentCountByGroup =
    new Map<string, number>();

  for (const enrollment of enrollments) {
    if (
      !enrollment.class_group_id ||
      enrollment.starts_on >
        selectedDate ||
      (
        enrollment.ends_on &&
        enrollment.ends_on <
          selectedDate
      )
    ) {
      continue;
    }

    enrollmentCountByGroup.set(
      enrollment.class_group_id,
      (
        enrollmentCountByGroup.get(
          enrollment.class_group_id,
        ) ?? 0
      ) + 1,
    );
  }

  const cancelledCount = sessions.filter(
    (session) =>
      Boolean(session.cancelled_at),
  ).length;

  const totalStudentCount = sessions.reduce(
    (total, session) =>
      total +
      (
        session.class_group_id
          ? enrollmentCountByGroup.get(
              session.class_group_id,
            ) ?? 0
          : 0
      ),
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
        <div className="mb-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          {params.success}
        </div>
      )}

      {params.error && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          {params.error}
        </div>
      )}

      {profile.role === "admin" && (
        <section className="mb-6 rounded-2xl border border-line bg-panel p-5 shadow-sm">
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h2 className="font-bold">
                Aylık oturumları oluştur
              </h2>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                Aktif programların haftalık gün ve
                saatlerinden seçilen ayın gerçek
                oturumları oluşturulur. Aynı işlem
                tekrar çalıştırılırsa mevcut
                oturumlar çoğaltılmaz.
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
                  defaultValue={selectedDate.slice(
                    0,
                    7,
                  )}
                  className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm"
                />
              </label>

              <button
                type="submit"
                className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white"
              >
                Ayın oturumlarını oluştur
              </button>
            </form>
          </div>
        </section>
      )}

      {profile.role === "teacher" && (
        <div className="mb-6 rounded-2xl border border-blue-200 dark:border-blue-800/40 bg-blue-50 dark:bg-blue-500/10 p-4 text-sm leading-6 text-blue-800 dark:text-blue-400">
          Aylık oturumları yönetici oluşturur. Size
          atanmış oturumlar oluşturulduğu anda bu
          ekranda görünür.
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-line bg-panel p-4 shadow-sm">
        <form
          method="get"
          className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end"
        >
          <Link
            href={`/yoklama?date=${previousDate}`}
            className="rounded-xl border border-line bg-panel px-4 py-3 text-center text-sm font-semibold text-brand-700"
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
              className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm"
            />
          </label>

          <button
            type="submit"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white"
          >
            Tarihe git
          </button>
        </form>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Link
            href={`/yoklama?date=${today}`}
            className="rounded-xl border border-honey-100 bg-honey-50 dark:bg-honey-500/10 px-4 py-2.5 text-center text-sm font-semibold text-honey-700 dark:text-honey-500"
          >
            Bugüne dön
          </Link>

          <Link
            href={`/yoklama?date=${nextDate}`}
            className="rounded-xl border border-line bg-panel px-4 py-2.5 text-center text-sm font-semibold text-brand-700"
          >
            Sonraki gün →
          </Link>
        </div>
      </section>

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Ders oturumu"
          value={sessions.length}
        />

        <SummaryCard
          label="Kalıcı öğrenci"
          value={totalStudentCount}
        />

        <SummaryCard
          label="İptal edilen"
          value={cancelledCount}
        />
      </section>

      <div className="mb-4">
        <h2 className="text-xl font-bold">
          {formatLongDate(selectedDate)}
        </h2>

        <p className="mt-1 text-sm text-muted">
          {selectedDate === today
            ? "Bugünün gerçek ders akışı"
            : "Seçilen tarihin gerçek ders akışı"}
        </p>
      </div>

      {(sessionsResult.error ||
        enrollmentsError) && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          Oturum verilerinin bir kısmı
          alınamadı.
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel px-6 py-16 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-fill text-2xl">
            ◫
          </div>

          <h3 className="mt-5 text-lg font-bold">
            Bu tarihte ders oturumu yok
          </h3>

          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
            {profile.role === "admin"
              ? "Seçilen ayın oturumları henüz oluşturulmadıysa yukarıdaki bölümden oluşturun. Programda o güne ait ders yoksa farklı bir tarih seçin."
              : "Yöneticinin oluşturduğu ve size atanmış bir oturum bulunmuyor. Farklı bir tarih seçebilirsiniz."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sessions.map((session) => {
            const studentCount =
              session.class_group_id
                ? enrollmentCountByGroup.get(
                    session.class_group_id,
                  ) ?? 0
                : 0;

            return (
              <article
                key={session.id}
                className={`rounded-2xl border bg-panel p-5 shadow-sm ${
                  session.cancelled_at
                    ? "border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10/30"
                    : "border-line"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-honey-700 dark:text-honey-500">
                      {formatTime(
                        session.starts_at,
                      )}{" "}
                      –{" "}
                      {formatTime(
                        session.ends_at,
                      )}
                    </p>

                    <h3 className="mt-1 text-lg font-bold">
                      {session.course?.name ??
                        "Ders bilgisi yok"}
                    </h3>

                    <p className="mt-1 text-sm text-muted">
                      {session.class_group?.name ??
                        "Program bilgisi yok"}
                    </p>
                  </div>

                  <SessionBadge
                    session={session}
                  />
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-fill p-3">
                    <dt className="text-muted">
                      Öğretmen
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {session.teacher
                        ?.full_name ??
                        "Atanmamış"}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-fill p-3">
                    <dt className="text-muted">
                      Derslik
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {session.room_name ??
                        "Belirtilmedi"}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-fill p-3">
                    <dt className="text-muted">
                      Kalıcı öğrenci
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {studentCount}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-fill p-3">
                    <dt className="text-muted">
                      Öğretmen onayı
                    </dt>
                    <dd className="mt-1 font-semibold">
                      {session.teacher_confirmed_at
                        ? "Onaylandı"
                        : "Bekliyor"}
                    </dd>
                  </div>
                </dl>

                {session.cancelled_at &&
                  session.cancellation_reason && (
                    <div className="mt-4 rounded-xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-400">
                      İptal nedeni:{" "}
                      {
                        session.cancellation_reason
                      }
                    </div>
                  )}

                <button
                  type="button"
                  disabled
                  className="mt-5 w-full rounded-xl bg-fill px-4 py-3 text-sm font-semibold text-muted"
                >
                  Yoklama girişi sonraki pakette
                  açılacak
                </button>

                <SessionComments
                  sessionId={session.id}
                  date={selectedDate}
                  comments={commentsBySession.get(session.id) ?? []}
                  canComment={
                    profile.role === "admin" ||
                    session.teacher_profile_id === profile.id
                  }
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

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4 shadow-sm">
      <p className="text-sm text-muted">
        {label}
      </p>

      <p className="mt-2 text-2xl font-bold">
        {value}
      </p>
    </div>
  );
}

function SessionBadge({
  session,
}: {
  session: SessionRow;
}) {
  if (session.cancelled_at) {
    return (
      <span className="rounded-full bg-rose-100 dark:bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-800 dark:text-rose-400">
        İptal
      </span>
    );
  }

  if (session.is_makeup) {
    return (
      <span className="rounded-full bg-blue-100 dark:bg-blue-500/15 px-3 py-1 text-xs font-bold text-blue-800 dark:text-blue-400">
        TELAFİ
      </span>
    );
  }

  return (
    <span className="rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-800 dark:text-emerald-400">
      Planlandı
    </span>
  );
}

function getTodayInIstanbul() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    },
  ).format(new Date());
}

function isIsoDate(
  value: string | undefined,
): value is string {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(
    `${value}T00:00:00.000Z`,
  );

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) ===
      value
  );
}

function addDays(
  value: string,
  amount: number,
) {
  const date = new Date(
    `${value}T12:00:00.000Z`,
  );

  date.setUTCDate(
    date.getUTCDate() + amount,
  );

  return date.toISOString().slice(0, 10);
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(
    new Date(`${value}T12:00:00+03:00`),
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
