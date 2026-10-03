import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { bulkAdjustCourseFees } from "../actions";
import { CourseForm } from "../course-form";

type CoursePageProps = {
  params: Promise<{
    courseId: string;
  }>;
  searchParams: Promise<{
    success?: string;
    error?: string;
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

export default async function CourseDetailPage({ params, searchParams }: CoursePageProps) {
  await requireRole(["admin"]);

  const { courseId } = await params;
  const messages = await searchParams;
  const supabase = await createClient();

  const [{ data, error }, { count: activeEnrollmentCount }] = await Promise.all([
    supabase
      .from("courses")
      .select(
        `
          id,
          name,
          code,
          course_type,
          default_duration_minutes,
          default_monthly_fee
        `,
      )
      .eq("id", courseId)
      .maybeSingle(),
    supabase
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .in("status", ["active", "frozen"]),
  ]);

  if (error) {
    console.error("Ders bilgisi alınamadı:", error);
  }

  if (!data) {
    notFound();
  }

  const course = data as CourseRow;

  return (
    <>
      <PageHeader
        title={`${course.name} Dersini Düzenle`}
        description="Ders türünü, süresini ve MEB onaylı ücret ilanını güncelleyin."
      />

      {messages.success && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {messages.success}
        </div>
      )}

      {messages.error && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {messages.error}
        </div>
      )}

      <CourseForm
        mode="edit"
        course={{
          id: course.id,
          name: course.name,
          code: course.code ?? "",
          courseType: course.course_type,
          durationMinutes: course.default_duration_minutes,
          monthlyFee: Number(course.default_monthly_fee),
        }}
      />

      <section className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <h3 className="text-lg font-bold">Toplu ücret güncelleme (zam)</h3>
        <p className="mt-1 text-sm text-text-secondary">
          Bu dersteki {activeEnrollmentCount ?? 0} aktif/dondurulmuş öğrencinin her birinin kendi
          ücretine, seçilen aydan itibaren artış uygular. Öğrencilere özel indirimler korunur. Tek
          bir öğrencinin ücretini değiştirmek için öğrenci sayfasını kullanın.
        </p>

        <form action={bulkAdjustCourseFees} className="mt-5 grid gap-4 md:grid-cols-4">
          <input type="hidden" name="courseId" value={course.id} />

          <label className="block text-sm font-medium">
            Geçerli olacağı ay
            <input
              type="month"
              name="effectiveMonth"
              required
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            />
          </label>

          <label className="block text-sm font-medium">
            Artış türü
            <select
              name="adjustType"
              defaultValue="percent"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            >
              <option value="percent">Yüzde (%)</option>
              <option value="fixed">Sabit tutar (TL)</option>
            </select>
          </label>

          <label className="block text-sm font-medium">
            Artış değeri
            <input
              name="adjustValue"
              required
              inputMode="decimal"
              placeholder="Örn. 20"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            />
          </label>

          <label className="block text-sm font-medium">
            Açıklama
            <input
              name="note"
              placeholder="Örn. Ocak zammı"
              className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
            />
          </label>

          <div className="md:col-span-4">
            <button
              type="submit"
              className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.98]"
            >
              Zammı uygula
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
