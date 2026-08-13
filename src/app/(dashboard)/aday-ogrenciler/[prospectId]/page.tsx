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
  "referral" | "social_media" | "website" | "walk_in" | "phone_call" | "advertisement" | "other";

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

export default async function ProspectDetailPage({
  params,
  searchParams,
}: ProspectDetailPageProps) {
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
            "id, starts_at, ends_at, room_name, cancelled_at, course:courses(name), teacher:profiles!lesson_sessions_teacher_profile_id_fkey(full_name)",
          )
          .eq("id", prospect.trial_lesson_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const courseList = (courses ?? []) as Course[];
  const staffList = (staff ?? []) as StaffMember[];
  const trialLesson = trialLessonResult.data as unknown as TrialLesson | null;

  const selectedCourseIds = new Set(
    prospect.prospect_course_interests.map((item) => item.course_id),
  );
  const isConverted = Boolean(prospect.converted_student_id);
  const hasActiveTrial = Boolean(trialLesson && !trialLesson.cancelled_at);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/aday-ogrenciler"
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          ← Aday öğrenciler
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-text-primary">
          {prospect.student_first_name} {prospect.student_last_name}
        </h2>
        <StatusBadge label={statusLabels[prospect.status]} tone={statusTones[prospect.status]} />
      </div>

      <SettingsAlert success={searchParamsValue.success} error={searchParamsValue.error} />

      {isConverted && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          Bu aday öğrenciye dönüştürüldü.{" "}
          <Link
            href={`/ogrenciler/${prospect.converted_student_id}`}
            className="font-semibold hover:underline"
          >
            Öğrenci kaydını görüntüle →
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="mb-4 text-base font-semibold text-text-primary">Aday bilgileri</h3>

          <form action={updateProspect} className="space-y-3">
            <input type="hidden" name="prospectId" value={prospect.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-text-secondary">
                Öğrenci adı
                <input
                  name="studentFirstName"
                  required
                  minLength={2}
                  defaultValue={prospect.student_first_name}
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
              </label>

              <label className="text-xs font-medium text-text-secondary">
                Öğrenci soyadı
                <input
                  name="studentLastName"
                  required
                  minLength={2}
                  defaultValue={prospect.student_last_name}
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-text-secondary">
              Veli adı
              <input
                name="guardianName"
                required
                minLength={2}
                defaultValue={prospect.guardian_name}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="block text-xs font-medium text-text-secondary">
              Telefon
              <input
                name="phone"
                required
                defaultValue={prospect.phone}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-text-secondary">
                Kaynak
                <select
                  name="leadSource"
                  required
                  defaultValue={prospect.lead_source}
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                >
                  {Object.entries(leadSourceLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs font-medium text-text-secondary">
                Atanan personel
                <select
                  name="assignedProfileId"
                  defaultValue={prospect.assigned_profile_id ?? ""}
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
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
              <legend className="text-xs font-medium text-text-secondary">
                İlgilendiği dersler
              </legend>

              <div className="mt-2 flex flex-wrap gap-3">
                {courseList.length === 0 ? (
                  <p className="text-xs text-text-secondary">Henüz aktif ders yok.</p>
                ) : (
                  courseList.map((course) => (
                    <label
                      key={course.id}
                      className="flex items-center gap-1.5 text-xs text-text-primary"
                    >
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

            <label className="block text-xs font-medium text-text-secondary">
              Not
              <textarea
                name="notes"
                rows={3}
                defaultValue={prospect.notes ?? ""}
                className="mt-1 block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
            >
              Kaydet
            </button>
          </form>
        </Card>

        <div className="space-y-6">
          {!isConverted && (
            <Card className="p-6">
              <h3 className="mb-4 text-base font-semibold text-text-primary">Durum</h3>

              <form action={updateProspectStatus} className="space-y-3">
                <input type="hidden" name="prospectId" value={prospect.id} />

                <label className="block text-xs font-medium text-text-secondary">
                  Durum
                  <select
                    name="status"
                    required
                    defaultValue={prospect.status === "enrolled" ? "new" : prospect.status}
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  >
                    <option value="new">Yeni</option>
                    <option value="follow_up_required">Takip Gerekli</option>
                    <option value="appointment_scheduled">Randevu Planlandı</option>
                    <option value="trial_attended">Deneme Dersine Katıldı</option>
                    <option value="declined">Reddedildi</option>
                  </select>
                </label>

                <label className="block text-xs font-medium text-text-secondary">
                  Reddetme nedeni (yalnızca &quot;Reddedildi&quot; için)
                  <input
                    name="declineReason"
                    defaultValue={prospect.decline_reason ?? ""}
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="block text-xs font-medium text-text-secondary">
                  Sonraki takip tarihi
                  <input
                    name="nextFollowUpDate"
                    type="date"
                    defaultValue={prospect.next_follow_up_date ?? ""}
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <button
                  type="submit"
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-muted"
                >
                  Durumu güncelle
                </button>
              </form>
            </Card>
          )}

          {!isConverted && (
            <Card className="p-6">
              <h3 className="mb-4 text-base font-semibold text-text-primary">Deneme dersi</h3>

              {trialLesson && (
                <div
                  className={`mb-4 rounded-xl border p-3 text-sm ${
                    trialLesson.cancelled_at
                      ? "border-border text-text-secondary"
                      : "border-border-strong bg-primary-soft text-primary border-primary/30 dark:bg-primary/10 text-primary"
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

                  <label className="flex-1 text-xs font-medium text-text-secondary">
                    İptal gerekçesi
                    <input
                      name="reason"
                      required
                      className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                    />
                  </label>

                  <button
                    type="submit"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-muted"
                  >
                    İptal et
                  </button>
                </form>
              )}

              <p className="mb-3 text-xs text-text-secondary">
                {hasActiveTrial
                  ? "Yeni bir tarih seçmek, mevcut deneme dersini otomatik olarak iptal eder (yeniden planlama)."
                  : "Deneme dersi planlayın."}
              </p>

              <form action={scheduleTrialLesson} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="prospectId" value={prospect.id} />

                <label className="text-xs font-medium text-text-secondary">
                  Ders
                  <select
                    name="courseId"
                    required
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  >
                    <option value="">Seçin</option>
                    {courseList.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Öğretmen
                  <select
                    name="teacherProfileId"
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  >
                    <option value="">—</option>
                    {staffList.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.full_name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Tarih
                  <input
                    name="date"
                    type="date"
                    required
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Derslik (opsiyonel)
                  <input
                    name="roomName"
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Başlangıç saati
                  <input
                    name="startTime"
                    type="time"
                    required
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Bitiş saati
                  <input
                    name="endTime"
                    type="time"
                    required
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
                  >
                    {hasActiveTrial ? "Yeniden planla" : "Planla"}
                  </button>
                </div>
              </form>
            </Card>
          )}

          {!isConverted && (
            <Card className="p-6">
              <h3 className="mb-1 text-base font-semibold text-text-primary">Öğrenciye dönüştür</h3>

              <p className="mb-4 text-xs leading-5 text-text-secondary">
                Ad, veli adı ve telefon bilgisi yukarıdan otomatik aktarılır — yalnızca T.C. kimlik
                numaraları (aday aşamasında olamayacağı için) istenir.
              </p>

              <form action={convertProspectToStudent} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="prospectId" value={prospect.id} />

                <label className="text-xs font-medium text-text-secondary">
                  Öğrenci T.C. kimlik no
                  <input
                    name="studentIdentityNumber"
                    required
                    inputMode="numeric"
                    maxLength={11}
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Veli T.C. kimlik no
                  <input
                    name="guardianIdentityNumber"
                    required
                    inputMode="numeric"
                    maxLength={11}
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Doğum tarihi (opsiyonel)
                  <input
                    name="birthDate"
                    type="date"
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Kayıt tarihi
                  <input
                    name="registrationDate"
                    type="date"
                    defaultValue={getTodayInIstanbul()}
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Veli ikinci telefon (opsiyonel)
                  <input
                    name="guardianSecondaryPhone"
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary">
                  Veli e-posta (opsiyonel)
                  <input
                    name="guardianEmail"
                    type="email"
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <label className="text-xs font-medium text-text-secondary sm:col-span-2">
                  Yakınlık
                  <input
                    name="relationship"
                    defaultValue="Veli"
                    className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                  />
                </label>

                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
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
