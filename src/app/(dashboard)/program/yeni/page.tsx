import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClassGroupForm } from "../class-group-form";

type CourseOption = {
  id: string;
  name: string;
  course_type:
    | "individual"
    | "group";
  default_duration_minutes: number;
};

type TeacherOption = {
  id: string;
  full_name: string;
};

export default async function NewClassGroupPage() {
  await requireRole(["admin"]);

  const supabase = await createClient();

  const [
    coursesResult,
    teachersResult,
  ] = await Promise.all([
    supabase
      .from("courses")
      .select(`
        id,
        name,
        course_type,
        default_duration_minutes
      `)
      .eq("is_active", true)
      .order("name"),

    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .eq("role", "teacher")
      .order("full_name"),
  ]);

  if (coursesResult.error) {
    console.error(
      "Dersler alınamadı:",
      coursesResult.error,
    );
  }

  if (teachersResult.error) {
    console.error(
      "Öğretmenler alınamadı:",
      teachersResult.error,
    );
  }

  const courses =
    (coursesResult.data ??
      []) as CourseOption[];

  const teachers =
    (teachersResult.data ??
      []) as TeacherOption[];

  return (
    <>
      <PageHeader
        title="Yeni Ders Seansı"
        description="Haftalık ders gününü, saatini, öğretmeni ve kontenjanını belirleyin."
      />

      {courses.length === 0 ? (
        <div className="rounded-2xl border border-honey-100 bg-honey-50 dark:bg-honey-500/10 p-5 text-sm text-honey-700 dark:text-honey-500">
          Seans oluşturabilmek için önce aktif bir ders tanımı oluşturmalısınız.
        </div>
      ) : (
        <ClassGroupForm
          mode="create"
          courses={courses.map(
            (course) => ({
              id: course.id,
              name: course.name,
              courseType:
                course.course_type,
              defaultDurationMinutes:
                course.default_duration_minutes,
            }),
          )}
          teachers={teachers.map(
            (teacher) => ({
              id: teacher.id,
              fullName:
                teacher.full_name,
            }),
          )}
        />
      )}
    </>
  );
}
