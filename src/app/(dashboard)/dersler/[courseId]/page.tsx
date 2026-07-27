import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CourseForm } from "../course-form";

type CoursePageProps = {
  params: Promise<{
    courseId: string;
  }>;
};

type CourseRow = {
  id: string;
  name: string;
  code: string | null;
  course_type: "individual" | "group";
  default_duration_minutes: number;
  default_monthly_fee: number | string;
};

export default async function CourseDetailPage({
  params,
}: CoursePageProps) {
  await requireRole(["admin"]);

  const { courseId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("courses")
    .select(`
      id,
      name,
      code,
      course_type,
      default_duration_minutes,
      default_monthly_fee
    `)
    .eq("id", courseId)
    .maybeSingle();

  if (error) {
    console.error(
      "Ders bilgisi alınamadı:",
      error,
    );
  }

  if (!data) {
    notFound();
  }

  const course = data as CourseRow;

  return (
    <>
      <PageHeader
        title={`${course.name} Dersini Düzenle`}
        description="Ders türünü, süresini ve varsayılan aylık ücretini güncelleyin."
      />

      <CourseForm
        mode="edit"
        course={{
          id: course.id,
          name: course.name,
          code: course.code ?? "",
          courseType: course.course_type,
          durationMinutes:
            course.default_duration_minutes,
          monthlyFee: Number(
            course.default_monthly_fee,
          ),
        }}
      />
    </>
  );
}