import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createProspect } from "./actions";

type ProspectStatus =
  | "new"
  | "follow_up_required"
  | "appointment_scheduled"
  | "trial_attended"
  | "enrolled"
  | "declined";

type LeadSource =
  "referral" | "social_media" | "website" | "walk_in" | "phone_call" | "advertisement" | "other";

type ProspectRow = {
  id: string;
  student_first_name: string;
  student_last_name: string;
  guardian_name: string;
  phone: string;
  lead_source: LeadSource;
  status: ProspectStatus;
  next_follow_up_date: string | null;
  assigned: { full_name: string } | null;
};

type Course = { id: string; name: string };
type StaffMember = { id: string; full_name: string };

type ProspectsPageProps = {
  searchParams: Promise<{
    status?: string;
    success?: string;
    error?: string;
  }>;
};

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

const statusFilters: { value: string; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: "new", label: "Yeni" },
  { value: "follow_up_required", label: "Takip Gerekli" },
  { value: "appointment_scheduled", label: "Randevu Planlandı" },
  { value: "trial_attended", label: "Deneme Dersine Katıldı" },
  { value: "enrolled", label: "Kayıt Oldu" },
  { value: "declined", label: "Reddedildi" },
];

export default async function ProspectsPage({ searchParams }: ProspectsPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;
  const status = params.status ?? "";

  const supabase = await createClient();

  let prospectsQuery = supabase
    .from("prospects")
    .select(
      "id, student_first_name, student_last_name, guardian_name, phone, lead_source, status, next_follow_up_date, assigned:assigned_profile_id(full_name)",
    )
    .eq("organization_id", profile.organizationId)
    .order("created_at", { ascending: false });

  if (status) {
    prospectsQuery = prospectsQuery.eq("status", status);
  }

  const [{ data: prospects, error: prospectsError }, { data: courses }, { data: staff }] =
    await Promise.all([
      prospectsQuery,
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
    ]);

  if (prospectsError) {
    console.error("Aday öğrenci listesi alınamadı:", prospectsError);
  }

  const prospectList = (prospects ?? []) as unknown as ProspectRow[];
  const courseList = (courses ?? []) as Course[];
  const staffList = (staff ?? []) as StaffMember[];

  return (
    <>
      <PageHeader
        title="Aday Öğrenciler"
        description="Deneme dersi ve kayıt sürecindeki aday öğrencileri takip edin."
      />

      <SettingsAlert success={params.success} error={params.error} />

      <Card className="mb-6 p-6">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">
            + Yeni aday ekle
          </summary>

          <form action={createProspect} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-text-secondary">
              Öğrenci adı
              <input
                name="studentFirstName"
                required
                minLength={2}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Öğrenci soyadı
              <input
                name="studentLastName"
                required
                minLength={2}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Veli adı
              <input
                name="guardianName"
                required
                minLength={2}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Telefon
              <input
                name="phone"
                required
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Kaynak
              <select
                name="leadSource"
                required
                defaultValue="other"
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
              İlk iletişim tarihi
              <input
                name="initialContactDate"
                type="date"
                defaultValue={getTodayInIstanbul()}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Atanan personel (opsiyonel)
              <select
                name="assignedProfileId"
                defaultValue=""
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

            <fieldset className="sm:col-span-2">
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
                      <input type="checkbox" name="courseIds" value={course.id} />
                      {course.name}
                    </label>
                  ))
                )}
              </div>
            </fieldset>

            <label className="text-xs font-medium text-text-secondary sm:col-span-2">
              Not
              <textarea
                name="notes"
                rows={2}
                className="mt-1 block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
              >
                Aday ekle
              </button>
            </div>
          </form>
        </details>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {statusFilters.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value ? `/aday-ogrenciler?status=${filter.value}` : "/aday-ogrenciler"}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              status === filter.value
                ? "bg-primary text-on-primary"
                : "border border-border text-text-primary hover:bg-surface-muted"
            }`}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <Card className="p-0">
        {prospectList.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-text-secondary">
            Bu filtrede aday öğrenci kaydı yok.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-5 py-3">Öğrenci</th>
                  <th className="px-5 py-3">Veli</th>
                  <th className="px-5 py-3">Telefon</th>
                  <th className="px-5 py-3">Kaynak</th>
                  <th className="px-5 py-3">Atanan</th>
                  <th className="px-5 py-3">Sonraki takip</th>
                  <th className="px-5 py-3">Durum</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {prospectList.map((prospect) => (
                  <tr key={prospect.id} className="hover:bg-surface-muted">
                    <td className="px-5 py-4">
                      <Link
                        href={`/aday-ogrenciler/${prospect.id}`}
                        className="font-semibold text-text-primary hover:underline"
                      >
                        {prospect.student_first_name} {prospect.student_last_name}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-text-secondary">{prospect.guardian_name}</td>
                    <td className="px-5 py-4 text-text-secondary">{prospect.phone}</td>
                    <td className="px-5 py-4 text-text-secondary">
                      {leadSourceLabels[prospect.lead_source]}
                    </td>
                    <td className="px-5 py-4 text-text-secondary">
                      {prospect.assigned?.full_name ?? "—"}
                    </td>
                    <td className="px-5 py-4 text-text-secondary">
                      {prospect.next_follow_up_date
                        ? formatDate(prospect.next_follow_up_date)
                        : "—"}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge
                        label={statusLabels[prospect.status]}
                        tone={statusTones[prospect.status]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
