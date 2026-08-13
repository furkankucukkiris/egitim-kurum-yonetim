import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateCourseMebInfo, updateTeacherCourseMeb, updateMebPermitPolicy } from "./actions";
import { MebDeficiencyList, type DeficiencyRow } from "./meb-deficiency-list";

type PageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

type CourseRow = {
  id: string;
  name: string;
  meb_status: string;
  meb_program_name: string | null;
  meb_program_code: string | null;
  meb_approval_number: string | null;
  meb_valid_from: string | null;
  meb_valid_until: string | null;
  meb_note: string | null;
  meb_responsible_profile_id: string | null;
  meb_checked_at: string | null;
  meb_checked_by: string | null;
};

type GroupRow = {
  course_id: string;
  teacher_profile_id: string | null;

  course: {
    name: string;
  } | null;

  teacher: {
    full_name: string;
  } | null;
};

type AuthorizationRow = {
  id: string;
  teacher_profile_id: string;
  course_id: string;
  status: string;
  document_number: string | null;
  valid_from: string | null;
  valid_until: string | null;
  note: string | null;
  responsible_profile_id: string | null;
  checked_at: string | null;
  checked_by: string | null;
};

type ProfileOption = {
  id: string;
  full_name: string;
};

const mebStatusOptions = [
  ["approved", "MEB onaylı"],
  ["pending", "Başvuru/bekleme aşamasında"],
  ["not_registered", "MEB kayıtlı değil"],
  ["expired", "Süresi dolmuş"],
  ["unchecked", "Kontrol edilmedi"],
] as const;

export default async function MebManagementPage({ searchParams }: PageProps) {
  const profile = await requireRole(["admin"]);

  const messages = await searchParams;
  const supabase = await createClient();

  const [
    coursesResult,
    groupsResult,
    authorizationsResult,
    organizationResult,
    profilesResult,
    deficienciesResult,
  ] = await Promise.all([
    supabase
      .from("courses")
      .select(
        `
          id,
          name,
          meb_status,
          meb_program_name,
          meb_program_code,
          meb_approval_number,
          meb_valid_from,
          meb_valid_until,
          meb_note,
          meb_responsible_profile_id,
          meb_checked_at,
          meb_checked_by
        `,
      )
      .order("name"),

    supabase
      .from("class_groups")
      .select(
        `
          course_id,
          teacher_profile_id,
          course:courses (
            name
          ),
          teacher:profiles (
            full_name
          )
        `,
      )
      .not("teacher_profile_id", "is", null),

    supabase.from("teacher_course_meb_authorizations").select(`
      id,
      teacher_profile_id,
      course_id,
      status,
      document_number,
      valid_from,
      valid_until,
      note,
      responsible_profile_id,
      checked_at,
      checked_by
    `),

    supabase
      .from("organizations")
      .select("meb_permit_enforcement")
      .eq("id", profile.organizationId)
      .single(),

    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("organization_id", profile.organizationId)
      .order("full_name"),

    supabase.rpc("get_meb_deficiencies"),
  ]);

  const mebPermitEnforcement =
    (organizationResult.data as { meb_permit_enforcement: string } | null)
      ?.meb_permit_enforcement ?? "warn";

  const courses = (coursesResult.data ?? []) as CourseRow[];

  const groups = (groupsResult.data ?? []) as unknown as GroupRow[];

  const authorizations = (authorizationsResult.data ?? []) as AuthorizationRow[];

  const authorizationMap = new Map(
    authorizations.map((item) => [`${item.teacher_profile_id}:${item.course_id}`, item]),
  );

  const profiles = (profilesResult.data ?? []) as ProfileOption[];

  const profileNameById = new Map(profiles.map((item) => [item.id, item.full_name]));

  const deficiencies = (deficienciesResult.data ?? []) as DeficiencyRow[];

  if (deficienciesResult.error) {
    console.error("MEB eksik listesi alınamadı:", deficienciesResult.error);
  }

  const teacherCoursePairs = Array.from(
    new Map(
      groups
        .filter(
          (
            group,
          ): group is GroupRow & {
            teacher_profile_id: string;
          } => Boolean(group.teacher_profile_id),
        )
        .map((group) => [`${group.teacher_profile_id}:${group.course_id}`, group]),
    ).values(),
  );

  return (
    <>
      <PageHeader
        title="MEB Yönetimi"
        description="Derslerin, öğretmenlerin ve öğrenci ders kayıtlarının MEB durumlarını takip edin."
      />

      {messages.success && <Message type="success">{messages.success}</Message>}

      {messages.error && <Message type="error">{messages.error}</Message>}

      <MebDeficiencyList rows={deficiencies} />

      <section className="mb-8 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-xl font-bold">Öğretmen MEB izni politikası</h2>

        <p className="mt-1 text-sm text-text-secondary">
          Bir öğretmen, MEB onaylı bir derse geçerli bir çalışma izni olmadan atanmak istendiğinde
          ne olacağını belirler.
        </p>

        <form action={updateMebPermitPolicy} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-text-secondary">
            Politika
            <select
              name="policy"
              defaultValue={mebPermitEnforcement}
              className="mt-1 w-full min-w-[220px] rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            >
              <option value="warn">Uyar (atamaya izin ver, işaretle)</option>
              <option value="block">Engelle (atamayı tamamen reddet)</option>
            </select>
          </label>

          <button
            type="submit"
            className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover"
          >
            Kaydet
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">Derslerin MEB durumu</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Ders programının kurumunuz adına MEB sisteminde tanımlı olup olmadığını belirtin.
          </p>
        </div>

        {courses.map((course) => (
          <form
            id={`course-${course.id}`}
            key={course.id}
            action={updateCourseMebInfo}
            className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
          >
            <input type="hidden" name="courseId" value={course.id} />

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-bold">{course.name}</h3>

              <Link
                href={`/kurum-ayarlari/denetim-kayitlari?table=courses&search=${course.id}`}
                className="text-xs text-text-secondary underline underline-offset-4"
              >
                Tüm geçmiş
              </Link>
            </div>

            <p className="mt-1 text-xs text-text-secondary">
              {course.meb_checked_at
                ? `Son kontrol: ${formatDateTime(course.meb_checked_at)}${
                    course.meb_checked_by
                      ? ` — ${profileNameById.get(course.meb_checked_by) ?? "bilinmiyor"}`
                      : ""
                  }`
                : "Henüz kontrol edilmedi."}
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SelectField label="MEB durumu" name="status" defaultValue={course.meb_status} />

              <Field
                label="MEB program adı"
                name="programName"
                defaultValue={course.meb_program_name ?? ""}
              />

              <Field
                label="Program kodu"
                name="programCode"
                defaultValue={course.meb_program_code ?? ""}
              />

              <Field
                label="Onay/belge numarası"
                name="approvalNumber"
                defaultValue={course.meb_approval_number ?? ""}
              />

              <Field
                label="Geçerlilik başlangıcı"
                name="validFrom"
                type="date"
                defaultValue={course.meb_valid_from ?? ""}
              />

              <Field
                label="Geçerlilik bitişi"
                name="validUntil"
                type="date"
                defaultValue={course.meb_valid_until ?? ""}
              />

              <SelectResponsible
                defaultValue={course.meb_responsible_profile_id ?? ""}
                profiles={profiles}
              />

              <div className="md:col-span-2">
                <Field label="Açıklama" name="note" defaultValue={course.meb_note ?? ""} />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 text-sm font-semibold text-on-primary"
              >
                Ders MEB bilgisini kaydet
              </button>
            </div>
          </form>
        ))}
      </section>

      <section className="mt-10 space-y-4">
        <div>
          <h2 className="text-xl font-bold">Öğretmen–ders çalışma izinleri</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Öğretmenin yalnızca ilgili ders için MEB çalışma izni bulunup bulunmadığını takip edin.
          </p>
        </div>

        {teacherCoursePairs.length === 0 ? (
          <div className="rounded-2xl border border-accent/30 bg-accent-soft p-5 text-sm text-accent-strong">
            Öğretmen atanmış bir ders seansı bulunmuyor.
          </div>
        ) : (
          teacherCoursePairs.map((pair) => {
            const authorization = authorizationMap.get(
              `${pair.teacher_profile_id}:${pair.course_id}`,
            );

            return (
              <form
                id={`teacher_course-${pair.teacher_profile_id}-${pair.course_id}`}
                key={`${pair.teacher_profile_id}:${pair.course_id}`}
                action={updateTeacherCourseMeb}
                className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
              >
                <input type="hidden" name="teacherProfileId" value={pair.teacher_profile_id} />

                <input type="hidden" name="courseId" value={pair.course_id} />

                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-bold">
                    {pair.teacher?.full_name ?? "Öğretmen"} — {pair.course?.name ?? "Ders"}
                  </h3>

                  {authorization && (
                    <Link
                      href={`/kurum-ayarlari/denetim-kayitlari?table=teacher_course_meb_authorizations&search=${authorization.id}`}
                      className="text-xs text-text-secondary underline underline-offset-4"
                    >
                      Tüm geçmiş
                    </Link>
                  )}
                </div>

                <p className="mt-1 text-xs text-text-secondary">
                  {authorization?.checked_at
                    ? `Son kontrol: ${formatDateTime(authorization.checked_at)}${
                        authorization.checked_by
                          ? ` — ${profileNameById.get(authorization.checked_by) ?? "bilinmiyor"}`
                          : ""
                      }`
                    : "Henüz kontrol edilmedi."}
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <SelectField
                    label="Çalışma izni"
                    name="status"
                    defaultValue={authorization?.status ?? "unchecked"}
                  />

                  <Field
                    label="Belge/onay numarası"
                    name="documentNumber"
                    defaultValue={authorization?.document_number ?? ""}
                  />

                  <Field
                    label="Geçerlilik başlangıcı"
                    name="validFrom"
                    type="date"
                    defaultValue={authorization?.valid_from ?? ""}
                  />

                  <Field
                    label="Geçerlilik bitişi"
                    name="validUntil"
                    type="date"
                    defaultValue={authorization?.valid_until ?? ""}
                  />

                  <SelectResponsible
                    defaultValue={authorization?.responsible_profile_id ?? ""}
                    profiles={profiles}
                  />

                  <div className="md:col-span-2 xl:col-span-4">
                    <Field label="Açıklama" name="note" defaultValue={authorization?.note ?? ""} />
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 text-sm font-semibold text-on-primary"
                  >
                    Öğretmen MEB bilgisini kaydet
                  </button>
                </div>
              </form>
            );
          })
        )}
      </section>
    </>
  );
}

function Message({ type, children }: { type: "success" | "error"; children: React.ReactNode }) {
  return (
    <div
      className={`mb-5 rounded-2xl border p-4 text-sm ${
        type === "success"
          ? "border-success/30 bg-success-soft text-success"
          : "border-danger/30 bg-danger-soft text-danger"
      }`}
    >
      {children}
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}

      <select
        name={name}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
      >
        {mebStatusOptions.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}

      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm"
      />
    </label>
  );
}

function SelectResponsible({
  defaultValue,
  profiles,
}: {
  defaultValue: string;
  profiles: ProfileOption[];
}) {
  return (
    <label className="block text-sm font-medium">
      Sorumlu kişi
      <select
        name="responsibleProfileId"
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
      >
        <option value="">Atanmadı</option>

        {profiles.map((item) => (
          <option key={item.id} value={item.id}>
            {item.full_name}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
