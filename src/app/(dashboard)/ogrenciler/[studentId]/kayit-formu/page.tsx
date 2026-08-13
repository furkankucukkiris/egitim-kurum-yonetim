import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateRegistrationForm } from "./actions";
import { RegistrationFormPrintButton } from "./print-button";

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  photo_path: string | null;
};

type EnrollmentOptionRow = {
  id: string;
  status: string;
  starts_on: string;
  course: { name: string } | null;
  class_group: { name: string } | null;
};

type FormVersionRow = {
  id: string;
  version: number;
  is_current: boolean;
  generated_at: string;
};

type RegistrationFormRow = {
  id: string;
  form_number: string;
  version: number;
  is_current: boolean;
  generated_at: string;

  student_first_name: string;
  student_last_name: string;
  student_identity_number: string | null;
  birth_date: string | null;
  registration_date: string | null;

  guardian_full_name: string | null;
  guardian_identity_number: string | null;
  guardian_relationship: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;

  home_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  health_notes: string | null;

  course_name: string | null;
  class_group_name: string | null;
  starts_on: string | null;

  list_monthly_fee: number | string | null;
  discount_type: string | null;
  discount_value: number | string | null;
  net_monthly_fee: number | string | null;
  due_day: number | null;

  institution_rules_text: string | null;
  institution_rules_accepted: boolean;
  institution_rules_accepted_at: string | null;

  kvkk_notice_text: string | null;
  kvkk_consent_accepted: boolean;
  kvkk_consent_accepted_at: string | null;

  photo_video_consent: string | null;
};

const photoVideoConsentLabels: Record<string, string> = {
  izinli: "İzinli (genel kullanım)",
  sadece_kurum_ici: "Yalnızca kurum içi kullanım",
  izinsiz: "İzinsiz",
};

const discountTypeLabels: Record<string, string> = {
  none: "Yok",
  percent: "Yüzde",
  fixed: "Sabit tutar",
};

type RegistrationFormPageProps = {
  params: Promise<{ studentId: string }>;

  searchParams: Promise<{
    created?: string;
    success?: string;
    error?: string;
    version?: string;
  }>;
};

export default async function RegistrationFormPage({
  params,
  searchParams,
}: RegistrationFormPageProps) {
  const profile = await requireRole(["admin"]);
  const { studentId } = await params;
  const { created, success, error: errorMessage, version } = await searchParams;

  const supabase = await createClient();

  const [studentResult, organizationResult, enrollmentsResult, versionsResult] = await Promise.all([
    supabase
      .from("students")
      .select("id, first_name, last_name, photo_path")
      .eq("id", studentId)
      .eq("organization_id", profile.organizationId)
      .maybeSingle(),

    supabase.from("organizations").select("phone, email").eq("id", profile.organizationId).single(),

    supabase
      .from("enrollments")
      .select("id, status, starts_on, course:courses(name), class_group:class_groups(name)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),

    supabase
      .from("student_registration_forms")
      .select("id, version, is_current, generated_at")
      .eq("student_id", studentId)
      .order("version", { ascending: false }),
  ]);

  if (studentResult.error) {
    console.error("Kayıt formu için öğrenci alınamadı:", studentResult.error);
  }

  const student = studentResult.data as unknown as StudentRow | null;

  if (!student) {
    notFound();
  }

  const organization = organizationResult.data;
  const enrollments = (enrollmentsResult.data ?? []) as unknown as EnrollmentOptionRow[];
  const versions = (versionsResult.data ?? []) as FormVersionRow[];

  const requestedVersion = version ? Number(version) : null;

  const formQuery = supabase
    .from("student_registration_forms")
    .select("*")
    .eq("student_id", studentId);

  const { data: formData, error: formError } = requestedVersion
    ? await formQuery.eq("version", requestedVersion).maybeSingle()
    : await formQuery.eq("is_current", true).maybeSingle();

  if (formError) {
    console.error("Resmî kayıt formu alınamadı:", formError);
  }

  const form = formData as unknown as RegistrationFormRow | null;

  let photoUrl: string | null = null;

  if (student.photo_path) {
    const { data: signed } = await supabase.storage
      .from("student-photos")
      .createSignedUrl(student.photo_path, 60 * 10);

    photoUrl = signed?.signedUrl ?? null;
  }

  return (
    <>
      <PageHeader
        title="Resmî Kayıt Formu"
        description={`${student.first_name} ${student.last_name}`}
        action={form ? <RegistrationFormPrintButton formId={form.id} /> : undefined}
      />

      {created && (
        <div className="print:hidden mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          Öğrenci ve veli kaydı başarıyla oluşturuldu.
        </div>
      )}

      {success && (
        <div className="print:hidden mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {success}
        </div>
      )}

      {errorMessage && (
        <div className="print:hidden mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {errorMessage}
        </div>
      )}

      {requestedVersion && form && !form.is_current && (
        <div className="print:hidden mb-5 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm text-accent-strong">
          Bu, {form.version}. sürümdür ve artık geçerli değildir. Güncel sürüm için{" "}
          <Link
            href={`/ogrenciler/${studentId}/kayit-formu`}
            className="font-semibold underline underline-offset-4"
          >
            buraya tıklayın
          </Link>
          .
        </div>
      )}

      {!form && (
        <Card className="mx-auto max-w-2xl p-6 print:hidden">
          <p className="text-sm text-text-secondary">
            Bu öğrenci için resmî kayıt formu henüz oluşturulmadı.
          </p>

          <form action={generateRegistrationForm} className="mt-5 space-y-4">
            <input type="hidden" name="studentId" value={student.id} />

            <label className="block text-sm font-medium">
              Ders kaydı (varsa)
              <select
                name="enrollmentId"
                className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
              >
                <option value="">Ders kaydı seçilmedi</option>

                {enrollments.map((enrollment) => (
                  <option key={enrollment.id} value={enrollment.id}>
                    {enrollment.course?.name ?? "Ders"}
                    {enrollment.class_group?.name ? ` — ${enrollment.class_group.name}` : ""} (
                    {enrollment.status})
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary"
            >
              Form Oluştur
            </button>
          </form>
        </Card>
      )}

      {form && (
        <>
          <Card className="print-form mx-auto max-w-3xl p-8 text-sm">
            <div className="flex items-start justify-between gap-6 border-b border-border pb-6">
              <div className="flex items-center gap-4">
                {profile.organizationLogoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.organizationLogoUrl}
                    alt={profile.organizationName}
                    className="h-14 w-14 object-contain"
                  />
                )}

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logos/meb-logo.png" alt="MEB" className="h-14 w-14 object-contain" />

                <div>
                  <p className="font-bold text-text-primary">{profile.organizationName}</p>

                  {organization?.phone && (
                    <p className="text-xs text-text-secondary">{organization.phone}</p>
                  )}

                  {organization?.email && (
                    <p className="text-xs text-text-secondary">{organization.email}</p>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-xs uppercase tracking-wide text-text-secondary">
                  Öğrenci Kayıt Formu
                </p>
                <p className="mt-1 font-semibold text-text-primary">{form.form_number}</p>
                <p className="mt-1 text-xs text-text-secondary">
                  Düzenlenme tarihi: {formatDate(form.generated_at)}
                </p>
                <p className="mt-1 text-xs text-text-secondary">Sürüm: {form.version}</p>
              </div>
            </div>

            {photoUrl && (
              <div className="mt-4 flex justify-end">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt={`${form.student_first_name} ${form.student_last_name}`}
                  className="h-24 w-24 rounded-2xl border border-border object-cover"
                />
              </div>
            )}

            <Section title="Öğrenci bilgileri">
              <Field label="Ad Soyad">
                {form.student_first_name} {form.student_last_name}
              </Field>
              <Field label="T.C. Kimlik No">{form.student_identity_number ?? "—"}</Field>
              <Field label="Doğum tarihi">
                {form.birth_date ? formatDate(form.birth_date) : "—"}
              </Field>
              <Field label="Kayıt tarihi">
                {form.registration_date ? formatDate(form.registration_date) : "—"}
              </Field>
            </Section>

            <Section title="Veli bilgileri">
              <Field label="Ad Soyad">{form.guardian_full_name ?? "—"}</Field>
              <Field label="T.C. Kimlik No">{form.guardian_identity_number ?? "—"}</Field>
              <Field label="Yakınlık">{form.guardian_relationship ?? "—"}</Field>
              <Field label="Telefon">{form.guardian_phone ?? "—"}</Field>
              <Field label="E-posta">{form.guardian_email ?? "—"}</Field>
            </Section>

            <Section title="Adres ve acil durum">
              <Field label="Adres" full>
                {form.home_address ?? "—"}
              </Field>
              <Field label="Acil durumda aranacak kişi">{form.emergency_contact_name ?? "—"}</Field>
              <Field label="Acil durum telefonu">{form.emergency_contact_phone ?? "—"}</Field>
            </Section>

            <section className="break-inside-avoid mt-6 rounded-xl border border-danger/30 bg-danger-soft p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-danger">
                Hassas bilgi — sağlık / alerji notu
              </p>
              <p className="mt-2 whitespace-pre-wrap text-text-primary">
                {form.health_notes || "Belirtilmemiş."}
              </p>
            </section>

            <Section title="Ders / program bilgisi">
              <Field label="Ders">{form.course_name ?? "Ders kaydı bulunmuyor"}</Field>
              <Field label="Program">{form.class_group_name ?? "—"}</Field>
              <Field label="Başlangıç tarihi">
                {form.starts_on ? formatDate(form.starts_on) : "—"}
              </Field>
            </Section>

            <Section title="Ücretlendirme">
              <Field label="Liste ücreti">{formatMoney(form.list_monthly_fee)}</Field>
              <Field label="İndirim">
                {form.discount_type
                  ? `${discountTypeLabels[form.discount_type] ?? form.discount_type} — ${formatMoney(form.discount_value)}`
                  : "—"}
              </Field>
              <Field label="Net ücret">{formatMoney(form.net_monthly_fee)}</Field>
              <Field label="Ödeme günü">
                {form.due_day ? `Her ayın ${form.due_day}. günü` : "—"}
              </Field>
            </Section>

            <section className="break-inside-avoid mt-6">
              <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">
                Kurum kuralları
              </h3>

              <p className="mt-2 whitespace-pre-wrap text-text-primary">
                {form.institution_rules_text || "Kurum kuralları metni tanımlanmamış."}
              </p>

              <p className="mt-2 text-xs text-text-secondary">
                {form.institution_rules_accepted
                  ? `Kabul edildi (${
                      form.institution_rules_accepted_at
                        ? formatDate(form.institution_rules_accepted_at)
                        : "tarih belirtilmemiş"
                    })`
                  : "Henüz kabul edilmedi."}
              </p>
            </section>

            <section className="break-inside-avoid mt-6">
              <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">
                KVKK aydınlatma metni
              </h3>

              <p className="mt-2 whitespace-pre-wrap text-text-primary">
                {form.kvkk_notice_text || "KVKK aydınlatma metni tanımlanmamış."}
              </p>

              <p className="mt-2 text-xs text-text-secondary">
                {form.kvkk_consent_accepted
                  ? `Onaylandı (${
                      form.kvkk_consent_accepted_at
                        ? formatDate(form.kvkk_consent_accepted_at)
                        : "tarih belirtilmemiş"
                    })`
                  : "Henüz onaylanmadı."}
              </p>
            </section>

            <section className="break-inside-avoid mt-6">
              <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">
                Fotoğraf / video kullanım tercihi
              </h3>

              <p className="mt-2 text-text-primary">
                {form.photo_video_consent
                  ? (photoVideoConsentLabels[form.photo_video_consent] ?? form.photo_video_consent)
                  : "—"}
              </p>
            </section>

            <div className="break-inside-avoid mt-10 grid grid-cols-2 gap-10">
              <div>
                <p className="border-t border-ink pt-2 text-xs text-text-secondary">
                  Veli imzası / Ad Soyad / Tarih
                </p>
              </div>

              <div>
                <p className="border-t border-ink pt-2 text-xs text-text-secondary">
                  Kurum yetkilisi imzası / Ad Soyad / Tarih
                </p>
              </div>
            </div>
          </Card>

          <div className="print:hidden mx-auto mt-6 max-w-3xl">
            <form action={generateRegistrationForm} className="mb-6">
              <input type="hidden" name="studentId" value={student.id} />

              <div className="flex flex-wrap items-end gap-3">
                <label className="block text-sm font-medium">
                  Ders kaydı (varsa)
                  <select
                    name="enrollmentId"
                    className="mt-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm"
                  >
                    <option value="">Ders kaydı seçilmedi</option>

                    {enrollments.map((enrollment) => (
                      <option key={enrollment.id} value={enrollment.id}>
                        {enrollment.course?.name ?? "Ders"}
                        {enrollment.class_group?.name ? ` — ${enrollment.class_group.name}` : ""} (
                        {enrollment.status})
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary transition hover:bg-surface-muted text-primary"
                >
                  Yeni Sürüm Oluştur
                </button>
              </div>
            </form>

            {versions.length > 1 && (
              <div className="mb-6 text-sm">
                <p className="font-semibold text-text-primary">Geçmiş sürümler</p>

                <ul className="mt-2 space-y-1">
                  {versions.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={`/ogrenciler/${studentId}/kayit-formu?version=${item.version}`}
                        className="text-primary underline underline-offset-4 text-primary"
                      >
                        Sürüm {item.version}
                      </Link>{" "}
                      — {formatDate(item.generated_at)}
                      {item.is_current && " (geçerli)"}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link
              href={`/ogrenciler/${student.id}`}
              className="text-sm font-semibold text-primary underline underline-offset-4 text-primary"
            >
              Öğrenci kaydına git
            </Link>
          </div>
        </>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid mt-6">
      <h3 className="text-xs font-bold uppercase tracking-wide text-text-secondary">{title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-4">{children}</dl>
    </section>
  );
}

function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "col-span-2" : undefined}>
      <dt className="text-xs text-text-secondary">{label}</dt>
      <dd className="mt-1 font-semibold text-text-primary">{children}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value));
}

function formatMoney(value: number | string | null) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(Number(value));
}
