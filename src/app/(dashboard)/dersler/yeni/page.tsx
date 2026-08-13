import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { CourseForm } from "../course-form";

export default async function NewCoursePage() {
  await requireRole(["admin"]);

  return (
    <>
      <PageHeader
        title="Yeni Ders Tanımı"
        description="Birebir veya grup dersinin varsayılan süre ve ücret bilgilerini oluşturun."
      />

      <CourseForm mode="create" />
    </>
  );
}
