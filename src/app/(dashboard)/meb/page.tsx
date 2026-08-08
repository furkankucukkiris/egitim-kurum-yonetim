import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  updateCourseMebInfo,
  updateTeacherCourseMeb,
} from "./actions";

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
  teacher_profile_id: string;
  course_id: string;
  status: string;
  document_number: string | null;
  valid_from: string | null;
  valid_until: string | null;
  note: string | null;
};

const mebStatusOptions = [
  ["approved", "MEB onaylı"],
  ["pending", "Başvuru/bekleme aşamasında"],
  ["not_registered", "MEB kayıtlı değil"],
  ["expired", "Süresi dolmuş"],
  ["unchecked", "Kontrol edilmedi"],
] as const;

export default async function MebManagementPage({
  searchParams,
}: PageProps) {
  await requireRole(["admin"]);

  const messages = await searchParams;
  const supabase = await createClient();

  const [
    coursesResult,
    groupsResult,
    authorizationsResult,
  ] = await Promise.all([
    supabase
      .from("courses")
      .select(`
        id,
        name,
        meb_status,
        meb_program_name,
        meb_program_code,
        meb_approval_number,
        meb_valid_from,
        meb_valid_until,
        meb_note
      `)
      .order("name"),

    supabase
      .from("class_groups")
      .select(`
        course_id,
        teacher_profile_id,
        course:courses (
          name
        ),
        teacher:profiles (
          full_name
        )
      `)
      .not(
        "teacher_profile_id",
        "is",
        null,
      ),

    supabase
      .from(
        "teacher_course_meb_authorizations",
      )
      .select(`
        teacher_profile_id,
        course_id,
        status,
        document_number,
        valid_from,
        valid_until,
        note
      `),
  ]);

  const courses =
    (coursesResult.data ??
      []) as CourseRow[];

  const groups =
    (groupsResult.data ??
      []) as unknown as GroupRow[];

  const authorizations =
    (authorizationsResult.data ??
      []) as AuthorizationRow[];

  const authorizationMap = new Map(
    authorizations.map((item) => [
      `${item.teacher_profile_id}:${item.course_id}`,
      item,
    ]),
  );

  const teacherCoursePairs = Array.from(
    new Map(
      groups
        .filter(
          (
            group,
          ): group is GroupRow & {
            teacher_profile_id: string;
          } =>
            Boolean(
              group.teacher_profile_id,
            ),
        )
        .map((group) => [
          `${group.teacher_profile_id}:${group.course_id}`,
          group,
        ]),
    ).values(),
  );

  return (
    <>
      <PageHeader
        title="MEB Yönetimi"
        description="Derslerin, öğretmenlerin ve öğrenci ders kayıtlarının MEB durumlarını takip edin."
      />

      {messages.success && (
        <Message type="success">
          {messages.success}
        </Message>
      )}

      {messages.error && (
        <Message type="error">
          {messages.error}
        </Message>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">
            Derslerin MEB durumu
          </h2>

          <p className="mt-1 text-sm text-muted">
            Ders programının kurumunuz adına MEB sisteminde tanımlı olup olmadığını belirtin.
          </p>
        </div>

        {courses.map((course) => (
          <form
            key={course.id}
            action={updateCourseMebInfo}
            className="rounded-2xl border border-line bg-panel p-5 shadow-sm"
          >
            <input
              type="hidden"
              name="courseId"
              value={course.id}
            />

            <h3 className="font-bold">
              {course.name}
            </h3>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SelectField
                label="MEB durumu"
                name="status"
                defaultValue={
                  course.meb_status
                }
              />

              <Field
                label="MEB program adı"
                name="programName"
                defaultValue={
                  course.meb_program_name ??
                  ""
                }
              />

              <Field
                label="Program kodu"
                name="programCode"
                defaultValue={
                  course.meb_program_code ??
                  ""
                }
              />

              <Field
                label="Onay/belge numarası"
                name="approvalNumber"
                defaultValue={
                  course.meb_approval_number ??
                  ""
                }
              />

              <Field
                label="Geçerlilik başlangıcı"
                name="validFrom"
                type="date"
                defaultValue={
                  course.meb_valid_from ??
                  ""
                }
              />

              <Field
                label="Geçerlilik bitişi"
                name="validUntil"
                type="date"
                defaultValue={
                  course.meb_valid_until ??
                  ""
                }
              />

              <div className="md:col-span-2">
                <Field
                  label="Açıklama"
                  name="note"
                  defaultValue={
                    course.meb_note ?? ""
                  }
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-sm font-semibold text-white"
              >
                Ders MEB bilgisini kaydet
              </button>
            </div>
          </form>
        ))}
      </section>

      <section className="mt-10 space-y-4">
        <div>
          <h2 className="text-xl font-bold">
            Öğretmen–ders çalışma izinleri
          </h2>

          <p className="mt-1 text-sm text-muted">
            Öğretmenin yalnızca ilgili ders için MEB çalışma izni bulunup bulunmadığını takip edin.
          </p>
        </div>

        {teacherCoursePairs.length === 0 ? (
          <div className="rounded-2xl border border-honey-100 bg-honey-50 dark:bg-honey-500/10 p-5 text-sm text-honey-700 dark:text-honey-500">
            Öğretmen atanmış bir ders seansı bulunmuyor.
          </div>
        ) : (
          teacherCoursePairs.map((pair) => {
            const authorization =
              authorizationMap.get(
                `${pair.teacher_profile_id}:${pair.course_id}`,
              );

            return (
              <form
                key={`${pair.teacher_profile_id}:${pair.course_id}`}
                action={
                  updateTeacherCourseMeb
                }
                className="rounded-2xl border border-line bg-panel p-5 shadow-sm"
              >
                <input
                  type="hidden"
                  name="teacherProfileId"
                  value={
                    pair.teacher_profile_id
                  }
                />

                <input
                  type="hidden"
                  name="courseId"
                  value={pair.course_id}
                />

                <h3 className="font-bold">
                  {pair.teacher?.full_name ??
                    "Öğretmen"}{" "}
                  —{" "}
                  {pair.course?.name ??
                    "Ders"}
                </h3>

                <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <SelectField
                    label="Çalışma izni"
                    name="status"
                    defaultValue={
                      authorization?.status ??
                      "unchecked"
                    }
                  />

                  <Field
                    label="Belge/onay numarası"
                    name="documentNumber"
                    defaultValue={
                      authorization
                        ?.document_number ??
                      ""
                    }
                  />

                  <Field
                    label="Geçerlilik başlangıcı"
                    name="validFrom"
                    type="date"
                    defaultValue={
                      authorization
                        ?.valid_from ?? ""
                    }
                  />

                  <Field
                    label="Geçerlilik bitişi"
                    name="validUntil"
                    type="date"
                    defaultValue={
                      authorization
                        ?.valid_until ?? ""
                    }
                  />

                  <div className="md:col-span-2 xl:col-span-4">
                    <Field
                      label="Açıklama"
                      name="note"
                      defaultValue={
                        authorization?.note ??
                        ""
                      }
                    />
                  </div>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-sm font-semibold text-white"
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

function Message({
  type,
  children,
}: {
  type: "success" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`mb-5 rounded-2xl border p-4 text-sm ${
        type === "success"
          ? "border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400"
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
        className="mt-2 w-full rounded-xl border border-line bg-panel px-4 py-3 text-sm"
      >
        {mebStatusOptions.map(
          ([value, text]) => (
            <option
              key={value}
              value={value}
            >
              {text}
            </option>
          ),
        )}
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
        className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm"
      />
    </label>
  );
}