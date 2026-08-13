import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addWaitlistEntry,
  cancelEntry,
  enrollFromWaitlist,
  offerSeat,
  resolveOffer,
} from "./actions";

type WaitlistStatus = "waiting" | "offered" | "accepted" | "declined" | "expired" | "cancelled";

type Opportunity = {
  class_group_id: string;
  class_group_name: string;
  course_name: string;
  capacity: number;
  active_count: number;
  available_seats: number;
  waiting_count: number;
};

type WaitlistEntryRow = {
  id: string;
  class_group_id: string;
  priority: number;
  application_date: string;
  preferred_weekdays: number[];
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  status: WaitlistStatus;
  notes: string | null;
  decline_reason: string | null;
  converted_enrollment_id: string | null;
  class_group: {
    name: string;
    course: { name: string; default_monthly_fee: number | string } | null;
  } | null;
  student: { id: string; first_name: string; last_name: string } | null;
  prospect: {
    id: string;
    student_first_name: string;
    student_last_name: string;
    converted_student_id: string | null;
  } | null;
};

type ClassGroupOption = {
  id: string;
  name: string;
  capacity: number;
  course: { name: string } | null;
};

type StudentOption = { id: string; first_name: string; last_name: string };
type ProspectOption = { id: string; student_first_name: string; student_last_name: string };

const weekdayLabels: Record<number, string> = {
  1: "Pzt",
  2: "Sal",
  3: "Çar",
  4: "Per",
  5: "Cum",
  6: "Cmt",
  7: "Paz",
};

const statusLabels: Record<WaitlistStatus, string> = {
  waiting: "Sırada",
  offered: "Teklif Verildi",
  accepted: "Kabul Edildi",
  declined: "Reddedildi",
  expired: "Süresi Doldu",
  cancelled: "İptal",
};

const statusTones: Record<WaitlistStatus, BadgeTone> = {
  waiting: "neutral",
  offered: "warning",
  accepted: "success",
  declined: "danger",
  expired: "danger",
  cancelled: "neutral",
};

const statusFilters: { value: string; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: "waiting", label: "Sırada" },
  { value: "offered", label: "Teklif Verildi" },
  { value: "accepted", label: "Kabul Edildi" },
  { value: "declined", label: "Reddedildi" },
  { value: "expired", label: "Süresi Doldu" },
  { value: "cancelled", label: "İptal" },
];

type WaitlistPageProps = {
  searchParams: Promise<{
    status?: string;
    classGroupId?: string;
    success?: string;
    error?: string;
  }>;
};

export default async function WaitlistPage({ searchParams }: WaitlistPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;
  const status = params.status ?? "";
  const classGroupId = params.classGroupId ?? "";

  const supabase = await createClient();

  let entriesQuery = supabase
    .from("waitlist_entries")
    .select(
      "id, class_group_id, priority, application_date, preferred_weekdays, preferred_time_start, preferred_time_end, status, notes, decline_reason, converted_enrollment_id, class_group:class_groups(name, course:courses(name, default_monthly_fee)), student:students(id, first_name, last_name), prospect:prospects(id, student_first_name, student_last_name, converted_student_id)",
    )
    .eq("organization_id", profile.organizationId)
    .order("priority", { ascending: true })
    .order("application_date", { ascending: true });

  if (status) {
    entriesQuery = entriesQuery.eq("status", status);
  }

  if (classGroupId) {
    entriesQuery = entriesQuery.eq("class_group_id", classGroupId);
  }

  const [
    { data: opportunities, error: opportunitiesError },
    { data: entries, error: entriesError },
    { data: classGroups },
    { data: enrollmentRows },
    { data: students },
    { data: prospects },
  ] = await Promise.all([
    supabase.rpc("get_waitlist_opportunities"),
    entriesQuery,
    supabase
      .from("class_groups")
      .select("id, name, capacity, course:courses(name)")
      .eq("organization_id", profile.organizationId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("enrollments")
      .select("class_group_id, status")
      .in("status", ["active", "frozen"])
      .not("class_group_id", "is", null),
    supabase
      .from("students")
      .select("id, first_name, last_name")
      .eq("organization_id", profile.organizationId)
      .eq("status", "active")
      .order("last_name"),
    supabase
      .from("prospects")
      .select("id, student_first_name, student_last_name")
      .eq("organization_id", profile.organizationId)
      .is("converted_student_id", null)
      .order("student_last_name"),
  ]);

  if (opportunitiesError) console.error("Boş kontenjan fırsatları alınamadı:", opportunitiesError);
  if (entriesError) console.error("Bekleme listesi alınamadı:", entriesError);

  const opportunityList = (opportunities ?? []) as unknown as Opportunity[];
  const openOpportunities = opportunityList.filter((item) => item.available_seats > 0);
  const entryList = (entries ?? []) as unknown as WaitlistEntryRow[];
  const classGroupList = (classGroups ?? []) as unknown as ClassGroupOption[];
  const studentList = (students ?? []) as StudentOption[];
  const prospectList = (prospects ?? []) as ProspectOption[];

  const activeCountByGroup = new Map<string, number>();
  for (const row of (enrollmentRows ?? []) as { class_group_id: string | null }[]) {
    if (!row.class_group_id) continue;
    activeCountByGroup.set(
      row.class_group_id,
      (activeCountByGroup.get(row.class_group_id) ?? 0) + 1,
    );
  }

  return (
    <>
      <PageHeader
        title="Bekleme Listesi"
        description="Dolu ders seansları için sıradaki öğrenci ve aday öğrencileri yönetin."
      />

      <SettingsAlert success={params.success} error={params.error} />

      {openOpportunities.length > 0 && (
        <Card className="mb-6 border-accent/40 bg-accent-soft p-6 border-accent/40 bg-accent-soft">
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Kapasitesi açılan gruplar
          </h2>

          <p className="mb-4 text-xs leading-5 text-text-secondary">
            Bu gruplarda boş yer var ve bekleme listesinde sırada bekleyen aday öğrenci/öğrenci
            bulunuyor.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {openOpportunities.map((item) => (
              <Link
                key={item.class_group_id}
                href={`/bekleme-listesi?classGroupId=${item.class_group_id}`}
                className="rounded-xl border border-accent/40 bg-surface p-4 text-sm transition hover:bg-surface-muted border-accent/40"
              >
                <p className="font-semibold text-text-primary">{item.class_group_name}</p>
                <p className="mt-1 text-xs text-text-secondary">{item.course_name}</p>
                <p className="mt-2 text-xs">
                  <span className="font-semibold text-success">{item.available_seats} boş yer</span>{" "}
                  · {item.waiting_count} sırada bekleyen
                </p>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-6 p-6">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-text-primary">
            + Bekleme listesine ekle
          </summary>

          <form action={addWaitlistEntry} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-text-secondary sm:col-span-2">
              Ders seansı
              <select
                name="classGroupId"
                required
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              >
                <option value="">Seçin</option>
                {classGroupList.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.course?.name ?? "Ders"} — {group.name} (
                    {activeCountByGroup.get(group.id) ?? 0}/{group.capacity} dolu)
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Mevcut öğrenci
              <select
                name="studentId"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              >
                <option value="">—</option>
                {studentList.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.first_name} {student.last_name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Aday öğrenci
              <select
                name="prospectId"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              >
                <option value="">—</option>
                {prospectList.map((prospect) => (
                  <option key={prospect.id} value={prospect.id}>
                    {prospect.student_first_name} {prospect.student_last_name}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-xs text-text-secondary sm:col-span-2">
              Mevcut öğrenci veya aday öğrencilerden yalnızca birini seçin.
            </p>

            <label className="text-xs font-medium text-text-secondary">
              Öncelik (küçük sayı önce çağrılır)
              <input
                name="priority"
                type="number"
                defaultValue={0}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Başvuru tarihi
              <input
                name="applicationDate"
                type="date"
                defaultValue={getTodayInIstanbul()}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <fieldset className="sm:col-span-2">
              <legend className="text-xs font-medium text-text-secondary">
                Tercih edilen günler
              </legend>

              <div className="mt-2 flex flex-wrap gap-3">
                {Object.entries(weekdayLabels).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-1.5 text-xs text-text-primary"
                  >
                    <input type="checkbox" name="preferredWeekdays" value={value} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="text-xs font-medium text-text-secondary">
              Tercih edilen başlangıç saati (opsiyonel)
              <input
                name="preferredTimeStart"
                type="time"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Tercih edilen bitiş saati (opsiyonel)
              <input
                name="preferredTimeEnd"
                type="time"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

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
                Bekleme listesine ekle
              </button>
            </div>
          </form>
        </details>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        {statusFilters.map((filter) => (
          <Link
            key={filter.value}
            href={
              filter.value
                ? `/bekleme-listesi?status=${filter.value}${classGroupId ? `&classGroupId=${classGroupId}` : ""}`
                : `/bekleme-listesi${classGroupId ? `?classGroupId=${classGroupId}` : ""}`
            }
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              status === filter.value
                ? "bg-primary text-on-primary"
                : "border border-border text-text-primary hover:bg-surface-muted"
            }`}
          >
            {filter.label}
          </Link>
        ))}

        {classGroupId && (
          <Link
            href={`/bekleme-listesi${status ? `?status=${status}` : ""}`}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-surface-muted"
          >
            Grup filtresini temizle ✕
          </Link>
        )}
      </div>

      <Card className="p-0">
        {entryList.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-text-secondary">
            Bu filtrede bekleme listesi kaydı yok.
          </p>
        ) : (
          <div className="space-y-3 p-4">
            {entryList.map((entry) => {
              const personName = entry.student
                ? `${entry.student.first_name} ${entry.student.last_name}`
                : entry.prospect
                  ? `${entry.prospect.student_first_name} ${entry.prospect.student_last_name}`
                  : "—";
              const isProspect = Boolean(entry.prospect);
              const prospectConverted = Boolean(entry.prospect?.converted_student_id);

              return (
                <div key={entry.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">
                        {personName}{" "}
                        <StatusBadge label={isProspect ? "Aday" : "Öğrenci"} tone="neutral" />
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        {entry.class_group?.course?.name ?? "Ders bilgisi yok"} —{" "}
                        {entry.class_group?.name ?? "Seans bilgisi yok"}
                      </p>
                    </div>

                    <StatusBadge
                      label={statusLabels[entry.status]}
                      tone={statusTones[entry.status]}
                    />
                  </div>

                  <p className="mt-2 text-xs text-text-secondary">
                    Öncelik: {entry.priority} · Başvuru: {formatDate(entry.application_date)}
                    {entry.preferred_weekdays.length > 0 &&
                      ` · Tercih: ${entry.preferred_weekdays.map((d) => weekdayLabels[d]).join(", ")}`}
                    {entry.preferred_time_start &&
                      ` ${entry.preferred_time_start.slice(0, 5)}–${entry.preferred_time_end?.slice(0, 5) ?? ""}`}
                  </p>

                  {entry.notes && (
                    <p className="mt-2 text-xs text-text-secondary">Not: {entry.notes}</p>
                  )}

                  {entry.decline_reason && (
                    <p className="mt-2 text-xs text-text-secondary">
                      Gerekçe: {entry.decline_reason}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.status === "waiting" && (
                      <>
                        <form action={offerSeat}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <button
                            type="submit"
                            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:bg-primary-hover"
                          >
                            Teklif ver
                          </button>
                        </form>

                        <form action={cancelEntry}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="reason" value="Admin tarafından kaldırıldı" />
                          <button
                            type="submit"
                            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                          >
                            İptal et
                          </button>
                        </form>
                      </>
                    )}

                    {entry.status === "offered" && (
                      <>
                        <form action={resolveOffer}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="resolution" value="accepted" />
                          <button
                            type="submit"
                            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:bg-primary-hover"
                          >
                            Kabul edildi
                          </button>
                        </form>

                        <form action={resolveOffer} className="flex items-center gap-2">
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="resolution" value="declined" />
                          <input
                            name="declineReason"
                            placeholder="Reddetme nedeni"
                            required
                            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
                          />
                          <button
                            type="submit"
                            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                          >
                            Reddedildi
                          </button>
                        </form>

                        <form action={resolveOffer}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="resolution" value="expired" />
                          <button
                            type="submit"
                            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                          >
                            Süresi doldu
                          </button>
                        </form>

                        <form action={cancelEntry}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="reason" value="Admin tarafından kaldırıldı" />
                          <button
                            type="submit"
                            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                          >
                            İptal et
                          </button>
                        </form>
                      </>
                    )}

                    {entry.status === "accepted" && !entry.converted_enrollment_id && (
                      <>
                        {isProspect && !prospectConverted ? (
                          <Link
                            href={`/aday-ogrenciler/${entry.prospect!.id}`}
                            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:bg-primary-hover"
                          >
                            Önce öğrenciye dönüştür →
                          </Link>
                        ) : (
                          <form
                            action={enrollFromWaitlist}
                            className="flex flex-wrap items-end gap-2"
                          >
                            <input type="hidden" name="entryId" value={entry.id} />
                            <label className="text-xs font-medium text-text-secondary">
                              Kayıt başlangıcı
                              <input
                                name="startsOn"
                                type="date"
                                required
                                defaultValue={getTodayInIstanbul()}
                                className="mt-1 block rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
                              />
                            </label>
                            <label className="text-xs font-medium text-text-secondary">
                              Aylık ücret
                              <input
                                name="listMonthlyFee"
                                type="text"
                                required
                                defaultValue={
                                  entry.class_group?.course?.default_monthly_fee !== undefined
                                    ? String(entry.class_group.course.default_monthly_fee)
                                    : ""
                                }
                                placeholder="0.00"
                                className="mt-1 block w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
                              />
                            </label>
                            <label className="text-xs font-medium text-text-secondary">
                              Vade günü
                              <input
                                name="dueDay"
                                type="number"
                                min={1}
                                max={28}
                                defaultValue={5}
                                className="mt-1 block w-16 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary"
                              />
                            </label>
                            <button
                              type="submit"
                              className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-on-primary transition hover:bg-primary-hover"
                            >
                              Derse kaydet
                            </button>
                          </form>
                        )}
                      </>
                    )}

                    {entry.converted_enrollment_id && (
                      <StatusBadge label="Derse kaydedildi" tone="success" />
                    )}
                  </div>
                </div>
              );
            })}
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
