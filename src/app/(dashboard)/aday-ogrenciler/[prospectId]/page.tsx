import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  cancelTrialLesson,
  convertProspectToStudent,
  scheduleTrialLesson,
  updateProspect,
  updateProspectStatus,
} from "../actions";

type ProspectStatus =
  | "new"
  | "follow_up_required"
  | "appointment_scheduled"
  | "trial_attended"
  | "enrolled"
  | "declined";

type LeadSource =
  | "referral"
  | "social_media"
  | "website"
  | "walk_in"
  | "phone_call"
  | "advertisement"
  | "other";

type ProspectDetail = {
  id: string;
  student_first_name: string;
  student_last_name: string;
  guardian_name: string;
  phone: string;
  lead_source: LeadSource;
  status: ProspectStatus;
  decline_reason: string | null;
  next_follow_up_date: string | null;
  notes: string | null;
  initial_contact_date: string;
  assigned_profile_id: string | null;
  trial_lesson_id: string | null;
  converted_student_id: string | null;
  prospect_course_interests: { course_id: string }[];
};

type TrialLesson = {
  id: string;
  starts_at: string;
  ends_at: string;
  room_name: string | null;
  cancelled_at: string | null;
  course: { name: string } | null;
  teacher: { full_name: string } | null;
};

type Course = { id: string; name: string };
type StaffMember = { id: string; full_name: string };

const statusLabels: Record<ProspectStatus, string> = {
  new: "Yeni",
  follow_up_required: "Takip Gerekli",
  appointment_scheduled: "Randevu Planlandı",
  trial_attended: "Deneme Dersine Katıldı",
  enrolled: "Kayıt Oldu",
  declined: "Reddedildi",
};

const statusTones: Record<ProspectStatus, BadgeTone> = {
  new: "neutral",
  follow_up_required: "warning",
  appointment_scheduled: "warning",
  trial_attended: "success",
  enrolled: "success",
  declined: "danger",
};

const leadSourceLabels: Record<LeadSource, string> = {
  referral: "Tavsiye",
  social_media: "Sosyal Medya",
  website: "Web Sitesi",
  walk_in: "Yürüyerek Geldi",
  phone_call: "Telefon",
  advertisement: "Reklam",
  other: "Diğer",
};

type ProspectDetailPageProps = {
  params: Promise<{ prospectId: string }>;
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function ProspectDetailPage({ params, searchParams }: ProspectDetailPageProps) {
  const profile = await requireRole(["admin"]);
  const { prospectId } = await params;
  const searchParamsValue = await searchParams;

  const supabase = await createClient();

  const { data: prospectData, error: prospectError } = await supabase
    .from("prospects")
    .select(
      "id, student_first_name, student_last_name, guardian_name, phone, lead_source, status, decline_reason, next_follow_up_date, notes, initial_contact_date, assigned_profile_id, trial_lesson_id, converted_student_id, prospect_course_interests(course_id)",
    )
    .eq("id", prospectId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (prospectError) {
    console.error("Aday öğrenci alınamadı:", prospectError);
  }

  if (!prospectData) {
    notFound();
  }

  const prospect = prospectData as unknown as ProspectDetail;

  const [{ data: courses }, { data: staff }, trialLessonResult] = await Promise.all([
    supabase
      .from("courses")
      .select("id, name")
      .eq("organization_id", profile.organizationId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("organization_id", profile.organizationId)
      .eq("is_active", true)
      .order("full_name"),
    prospect.trial_lesson_id
      ? supabase
          .from("lesson_sessions")
          .select(
            "id, starts_at, ends_at, room_name, cancelled_at, course:courses(name), teacher:profiles!teacher_profile_id(full_name)",
          )
          .eq("id", prospect.trial_lesson_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const courseList = (courses ?? []) as Course[];
  const staffList = (staff ?? []) as StaffMember[];
  const trialLesson = trialLessonResult.data as unknown as TrialLesson | null;

  const selectedCourseIds = new Set(prospect.prospect_course_interests.map((item) => item.course_id));
  const isConverted = Boolean(prospect.converted_student_id);
  const hasActiveTrial = Boolean(trialLesson && !trialLesson.cancelled_at);

  return (
    <>
      <div className="mb-4">
        <Link href="/aday-ogrenciler" className="text-sm text-muted hover:text-ink">
          ← Aday öğrenciler
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-ink">
          {prospect.student_first_name} {prospect.student_last_name}
        </h2>
        <StatusBadge label={statusLabels[prospect.status]} tone={statusTones[prospect.status]} />
      </div>

      <SettingsAlert success={searchParamsValue.success} error={searchParamsValue.error} />

      {isConverted && (
        <div className="mb-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Bu aday öğrenciye dönüştürüldü.{" "}
          <Link href={`/ogrenciler/${prospect.converted_student_id}`} className="font-semibold hover:underline">
            Öğrenci kaydını görüntüle →
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="mb-4 text-base font-semibold text-ink">Aday bilgileri</h3>

          <form action={updateProspect} className="space-y-3">
            <input type="hidden" name="prospectId" value={prospect.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted">
                Öğrenci adı
                <input
                  name="studentFirstName"
                  required
                  minLength={2}
                  defaultValue={prospect.student_first_name}
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>

              <label className="text-xs font-medium text-muted">
                Öğrenci soyadı
                <input
                  name="studentLastName"
                  required
                  minLength={2}
                  defaultValue={prospect.student_last_name}
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-muted">
              Veli adı
              <input
                name="guardianName"
                required
                minLength={2}
                defaultValue={prospect.guardian_name}
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <label className="block text-xs font-medium text-muted">
              Telefon
              <input
                name="phone"
                required
                defaultValue={prospect.phone}
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-muted">
                Kaynak
                <select
                  name="leadSource"
                  required
                  defaultValue={prospect.lead_source}
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                >
                  {Object.entries(leadSourceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-medium text-muted">
                Atanan personel
                <select
                  name="assignedProfileId"
                  defaultValue={prospect.assigned_profile_id ?? ""}
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                >
                  <option value="">—</option>
                  {staffList.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset>
              <legend className="text-xs font-medium text-muted">İlgilendiği dersler</legend>

              <div className="mt-2 flex flex-wrap gap-3">
                {courseList.length === 0 ? (
                  <p className="text-xs text-muted">Henüz aktif ders yok.</p>
                ) : (
                  courseList.map((course) => (
                    <label key={course.id} className="flex items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox"
                        name="courseIds"
                        value={course.id}
                        defaultChecked={selectedCourseIds.has(course.id)}
                      />
                      {course.name}
                    </label>
                  ))
                )}
              </div>
            </fieldset>

            <label className="block text-xs font-medium text-muted">
              Not
              <textarea
                name="notes"
                rows={3}
                defaultValue={prospect.notes ?? ""}
                className="mt-1 block w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <button
              type="submit"
              className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
            >
              Kaydet
            </button>
          </form>
        </Card>

        <div className="space-y-6">
          {!isConverted && (
            <Card className="p-6">
              <h3 className="mb-4 text-base font-semibold text-ink">Durum</h3>

              <form action={updateProspectStatus} className="space-y-3">
                <input type="hidden" name="prospectId" value={prospect.id} />

                <label className="block text-xs font-medium text-muted">
                  Durum
                  <select
                    name="status"
                    required
                    defaultValue={prospect.status === "enrolled" ? "new" : prospect.status}
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  >
                    <option value="new">Yeni</option>
                    <option value="follow_up_required">Takip Gerekli</option>
                    <option value="appointment_scheduled">Randevu Planlandı</option>
                    <option value="trial_attended">Deneme Dersine Katıldı</option>
                    <option value="declined">Reddedildi</option>
                  </select>
                </label>

                <label className="block text-xs font-medium text-muted">
                  Reddetme nedeni (yalnızca &quot;Reddedildi&quot; için)
                  <input
                    name="declineReason"
                    defaultValue={prospect.decline_reason ?? ""}
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="block text-xs font-medium text-muted">
                  Sonraki takip tarihi
                  <input
                    name="nextFollowUpDate"
                    type="date"
                    defaultValue={prospect.next_follow_up_date ?? ""}
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <button
                  type="submit"
                  className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill"
                >
                  Durumu güncelle
                </button>
              </form>
            </Card>
          )}

          {!isConverted && (
            <Card className="p-6">
              <h3 className="mb-4 text-base font-semibold text-ink">Deneme dersi</h3>

              {trialLesson && (
                <div
                  className={`mb-4 rounded-xl border p-3 text-sm ${
                    trialLesson.cancelled_at
                      ? "border-line text-muted"
                      : "border-terra-200 bg-terra-50 text-terra-800 dark:border-terra-800/40 dark:bg-terra-500/10 dark:text-terra-200"
                  }`}
                >
                  <p className="font-medium">
                    {trialLesson.course?.name ?? "Ders bilgisi yok"}
                    {trialLesson.cancelled_at ? " (iptal edildi)" : ""}
                  </p>
                  <p className="mt-1 text-xs">
                    {formatDateTime(trialLesson.starts_at)} – {formatTime(trialLesson.ends_at)}
                    {trialLesson.room_name ? ` · ${trialLesson.room_name}` : ""}
                  </p>
                  <p className="mt-1 text-xs">
                    Öğretmen: {trialLesson.teacher?.full_name ?? "Atanmamış"}
                  </p>
                </div>
              )}

              {hasActiveTrial && (
                <form action={cancelTrialLesson} className="mb-4 flex items-end gap-2">
                  <input type="hidden" name="prospectId" value={prospect.id} />

                  <label className="flex-1 text-xs font-medium text-muted">
                    İptal gerekçesi
                    <input
                      name="reason"
                      required
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>

                  <button
                    type="submit"
                    className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill"
                  >
                    İptal et
                  </button>
                </form>
              )}

              <p className="mb-3 text-xs text-muted">
                {hasActiveTrial
                  ? "Yeni bir tarih seçmek, mevcut deneme dersini otomatik olarak iptal eder (yeniden planlama)."
                  : "Deneme dersi planlayın."}
              </p>

              <form action={scheduleTrialLesson} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="prospectId" value={prospect.id} />

                <label className="text-xs font-medium text-muted">
                  Ders
                  <select
                    name="courseId"
                    required
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  >
                    <option value="">Seçin</option>
                    {courseList.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-medium text-muted">
                  Öğretmen
                  <select
                    name="teacherProfileId"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  >
                    <option value="">—</option>
                    {staffList.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-medium text-muted">
                  Tarih
                  <input
                    name="date"
                    type="date"
                    required
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Derslik (opsiyonel)
                  <input
                    name="roomName"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Başlangıç saati
                  <input
                    name="startTime"
                    type="time"
                    required
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Bitiş saati
                  <input
                    name="endTime"
                    type="time"
                    required
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
                  >
                    {hasActiveTrial ? "Yeniden planla" : "Planla"}
                  </button>
                </div>
              </form>
            </Card>
          )}

          {!isConverted && (
            <Card className="p-6">
              <h3 className="mb-1 text-base font-semibold text-ink">Öğrenciye dönüştür</h3>

              <p className="mb-4 text-xs leading-5 text-muted">
                Ad, veli adı ve telefon bilgisi yukarıdan otomatik aktarılır — yalnızca T.C.
                kimlik numaraları (aday aşamasında olamayacağı için) istenir.
              </p>

              <form action={convertProspectToStudent} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="prospectId" value={prospect.id} />

                <label className="text-xs font-medium text-muted">
                  Öğrenci T.C. kimlik no
                  <input
                    name="studentIdentityNumber"
                    required
                    inputMode="numeric"
                    maxLength={11}
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Veli T.C. kimlik no
                  <input
                    name="guardianIdentityNumber"
                    required
                    inputMode="numeric"
                    maxLength={11}
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Doğum tarihi (opsiyonel)
                  <input
                    name="birthDate"
                    type="date"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Kayıt tarihi
                  <input
                    name="registrationDate"
                    type="date"
                    defaultValue={getTodayInIstanbul()}
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Veli ikinci telefon (opsiyonel)
                  <input
                    name="guardianSecondaryPhone"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted">
                  Veli e-posta (opsiyonel)
                  <input
                    name="guardianEmail"
                    type="email"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <label className="text-xs font-medium text-muted sm:col-span-2">
                  Yakınlık
                  <input
                    name="relationship"
                    defaultValue="Veli"
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
                  >
                    Öğrenciye dönüştür
                  </button>
                </div>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
