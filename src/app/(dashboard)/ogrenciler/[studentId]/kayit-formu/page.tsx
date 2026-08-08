import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { PrintButton } from "@/components/students/PrintButton";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type GuardianRow = {
  full_name: string;
  phone: string;
};

type StudentGuardianRow = {
  relationship: string | null;
  is_primary: boolean;
  guardian: GuardianRow | null;
};

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  registration_date: string;
  notes: string | null;
  photo_path: string | null;
  student_guardians: StudentGuardianRow[];
};

type RegistrationFormPageProps = {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ created?: string }>;
};

export default async function RegistrationFormPage({
  params,
  searchParams,
}: RegistrationFormPageProps) {
  const profile = await requireRole(["admin", "finance"]);
  const { studentId } = await params;
  const { created } = await searchParams;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("students")
    .select(`
      id, first_name, last_name, birth_date, registration_date, notes, photo_path,
      student_guardians (
        relationship, is_primary,
        guardian:guardians ( full_name, phone )
      )
    `)
    .eq("id", studentId)
    .eq("organization_id", profile.organizationId)
    .maybeSingle();

  if (error) {
    console.error("Kayıt formu alınamadı:", error);
  }

  const student = data as unknown as StudentRow | null;

  if (!student) {
    notFound();
  }

  let photoUrl: string | null = null;

  if (student.photo_path) {
    const { data: signed } = await supabase.storage
      .from("student-photos")
      .createSignedUrl(student.photo_path, 60 * 10);

    photoUrl = signed?.signedUrl ?? null;
  }

  const primaryGuardian =
    student.student_guardians.find((item) => item.is_primary) ??
    student.student_guardians[0] ??
    null;

  return (
    <>
      <PageHeader
        title="Kayıt Formu"
        description="Öğrenci kayıt bilgilerinin önizlemesi ve çıktısı."
        action={<PrintButton />}
      />

      {created && (
        <div className="print:hidden mb-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Öğrenci ve veli kaydı başarıyla oluşturuldu.
        </div>
      )}

      <Card className="mx-auto max-w-2xl p-8">
        <div className="flex items-start justify-between gap-6 border-b border-line pb-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">
              {profile.organizationName}
            </p>
            <h2 className="mt-1 text-2xl font-bold text-ink">
              {student.first_name} {student.last_name}
            </h2>
            <p className="mt-1 text-sm text-muted">
              Kayıt tarihi: {formatDate(student.registration_date)}
            </p>
          </div>

          <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-fill">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt={`${student.first_name} ${student.last_name}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="px-2 text-center text-xs text-muted">Fotoğraf yok</span>
            )}
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-5 text-sm">
          <div>
            <dt className="text-muted">Doğum tarihi</dt>
            <dd className="mt-1 font-semibold text-ink">
              {student.birth_date ? formatDate(student.birth_date) : "Belirtilmedi"}
            </dd>
          </div>

          <div>
            <dt className="text-muted">Veli</dt>
            <dd className="mt-1 font-semibold text-ink">
              {primaryGuardian?.guardian?.full_name ?? "Belirtilmedi"}
            </dd>
          </div>

          <div>
            <dt className="text-muted">Yakınlık</dt>
            <dd className="mt-1 font-semibold text-ink">
              {primaryGuardian?.relationship ?? "—"}
            </dd>
          </div>

          <div>
            <dt className="text-muted">Telefon</dt>
            <dd className="mt-1 font-semibold text-ink">
              {primaryGuardian?.guardian?.phone ?? "—"}
            </dd>
          </div>

          {student.notes && (
            <div className="col-span-2">
              <dt className="text-muted">Not</dt>
              <dd className="mt-1 text-ink">{student.notes}</dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="print:hidden mx-auto mt-6 max-w-2xl">
        <Link
          href={`/ogrenciler/${student.id}`}
          className="text-sm font-semibold text-brand-700 underline underline-offset-4 dark:text-brand-100"
        >
          Öğrenci kaydına git
        </Link>
      </div>
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
