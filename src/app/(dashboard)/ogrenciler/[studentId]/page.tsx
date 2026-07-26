import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ArchiveStudentForm } from "./archive-student-form";
import { StudentEditForm } from "./student-edit-form";

type GuardianRow = {
  id: string;
  full_name: string;
  phone: string;
  secondary_phone: string | null;
  email: string | null;
};

type StudentGuardianRow = {
  guardian_id: string;
  relationship: string | null;
  is_primary: boolean;
  may_receive_financial_messages: boolean;
  guardian: GuardianRow | null;
};

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  registration_date: string;
  status:
    | "active"
    | "frozen"
    | "left"
    | "archived";
  exit_date: string | null;
  exit_reason: string | null;
  notes: string | null;
  student_guardians: StudentGuardianRow[];
};

type StudentDetailPageProps = {
  params: Promise<{
    studentId: string;
  }>;

  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

const statusLabels = {
  active: "Aktif",
  frozen: "Donduruldu",
  left: "Ayrıldı",
  archived: "Arşivlendi",
};

export default async function StudentDetailPage({
  params,
  searchParams,
}: StudentDetailPageProps) {
  await requireRole(["admin", "finance"]);

  const { studentId } = await params;
  const messages = await searchParams;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("students")
    .select(`
      id,
      first_name,
      last_name,
      birth_date,
      registration_date,
      status,
      exit_date,
      exit_reason,
      notes,
      student_guardians (
        guardian_id,
        relationship,
        is_primary,
        may_receive_financial_messages,
        guardian:guardians (
          id,
          full_name,
          phone,
          secondary_phone,
          email
        )
      )
    `)
    .eq("id", studentId)
    .maybeSingle();

  if (error) {
    console.error(
      "Öğrenci detayı alınamadı:",
      error,
    );
  }

  if (!data) {
    notFound();
  }

  const student =
    data as unknown as StudentRow;

  const primaryRelationship =
    student.student_guardians.find(
      (item) => item.is_primary,
    ) ??
    student.student_guardians[0];

  const primaryGuardian =
    primaryRelationship?.guardian;

  if (!primaryRelationship || !primaryGuardian) {
    return (
      <>
        <PageHeader
          title={`${student.first_name} ${student.last_name}`}
          description="Öğrenci kaydına bağlı birincil veli bulunamadı."
        />

        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          Bu öğrencinin veli ilişkisinde eksiklik bulunuyor.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${student.first_name} ${student.last_name}`}
        description={`Durum: ${
          statusLabels[student.status]
        }`}
        action={
          <Link
            href="/ogrenciler"
            className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          >
            Öğrenci listesine dön
          </Link>
        }
      />

      {messages.success && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          {messages.success}
        </div>
      )}

      {messages.error && (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {messages.error}
        </div>
      )}

      {student.status === "archived" && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <p className="font-semibold text-amber-800">
            Bu öğrenci arşivlenmiş durumda.
          </p>

          <p className="mt-2 text-sm text-amber-700">
            Arşiv tarihi:{" "}
            {student.exit_date
              ? formatDate(student.exit_date)
              : "Belirtilmedi"}
          </p>

          {student.exit_reason && (
            <p className="mt-1 text-sm text-amber-700">
              Neden: {student.exit_reason}
            </p>
          )}
        </div>
      )}

      <StudentEditForm
        student={{
          id: student.id,
          firstName: student.first_name,
          lastName: student.last_name,
          birthDate:
            student.birth_date ?? "",
          registrationDate:
            student.registration_date,
          notes: student.notes ?? "",
        }}
        guardian={{
          id: primaryGuardian.id,
          fullName:
            primaryGuardian.full_name,
          phone: primaryGuardian.phone,
          secondaryPhone:
            primaryGuardian.secondary_phone ??
            "",
          email:
            primaryGuardian.email ?? "",
          relationship:
            primaryRelationship.relationship ??
            "Veli",
          mayReceiveFinancialMessages:
            primaryRelationship
              .may_receive_financial_messages,
        }}
      />

      {student.status !== "archived" && (
        <div className="mt-8 border-t border-slate-200 pt-8">
          <ArchiveStudentForm
            studentId={student.id}
          />
        </div>
      )}
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(
    "tr-TR",
    {
      timeZone: "Europe/Istanbul",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    },
  ).format(
    new Date(
      `${value}T00:00:00.000Z`,
    ),
  );
}