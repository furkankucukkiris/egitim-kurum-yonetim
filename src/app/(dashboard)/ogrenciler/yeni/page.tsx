import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { StudentForm } from "./student-form";

export default async function NewStudentPage() {
  await requireRole(["admin", "finance"]);

  const today = getTodayInIstanbul();

  return (
    <>
      <PageHeader
        title="Yeni Öğrenci Kaydı"
        description="Öğrencinin temel bilgilerini ve birincil veli iletişim bilgilerini kaydedin."
      />

      <StudentForm
        initialRegistrationDate={today}
      />
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