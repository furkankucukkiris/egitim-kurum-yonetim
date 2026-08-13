import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type StudentStatus = "active" | "frozen" | "left" | "archived";

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
  status: StudentStatus;
  student_guardians: StudentGuardianRow[];
};

type StudentsPageProps = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    success?: string;
  }>;
};

const statusLabels: Record<StudentStatus, string> = {
  active: "Aktif",
  frozen: "Donduruldu",
  left: "Ayrıldı",
  archived: "Arşivlendi",
};

const statusClasses: Record<StudentStatus, string> = {
  active: "bg-success-soft text-success",
  frozen: "bg-accent-soft text-accent-strong",
  left: "bg-danger-soft text-danger",
  archived: "bg-surface-muted text-text-secondary",
};

const validStatuses: StudentStatus[] = ["active", "frozen", "left", "archived"];

export default async function StudentsPage({ searchParams }: StudentsPageProps) {
  await requireRole(["admin"]);

  const params = await searchParams;

  const searchText = String(params.q ?? "").trim();
  const requestedStatus = String(params.status ?? "");

  const selectedStatus = validStatuses.includes(requestedStatus as StudentStatus)
    ? (requestedStatus as StudentStatus)
    : "";

  const supabase = await createClient();

  let query = supabase
    .from("students")
    .select(
      `
        id,
        first_name,
        last_name,
        birth_date,
        registration_date,
        status,
        student_guardians (
          relationship,
          is_primary,
          guardian:guardians (
            full_name,
            phone
          )
        )
      `,
    )
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (selectedStatus) {
    query = query.eq("status", selectedStatus);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Öğrenci listesi alınamadı:", error);
  }

  const studentRows = (data ?? []) as unknown as StudentRow[];

  const normalizedSearch = searchText.toLocaleLowerCase("tr-TR");

  const students = studentRows.filter((student) => {
    if (!normalizedSearch) {
      return true;
    }

    const guardianNames = student.student_guardians
      .map((item) => item.guardian?.full_name ?? "")
      .join(" ");

    const searchableText = [student.first_name, student.last_name, guardianNames]
      .join(" ")
      .toLocaleLowerCase("tr-TR");

    return searchableText.includes(normalizedSearch);
  });

  return (
    <>
      <PageHeader
        title="Öğrenciler"
        description="Öğrenci ve birincil veli kayıtlarını görüntüleyin ve yönetin."
        action={
          <Link
            href="/ogrenciler/yeni"
            className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 text-center text-sm font-semibold text-on-primary transition hover:bg-primary-hover"
          >
            + Öğrenci ekle
          </Link>
        }
      />

      {params.success && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {params.success}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Öğrenci kayıtları alınamadı. VS Code terminalindeki hata mesajını kontrol edin.
        </div>
      )}

      <form method="get" className="mb-4 grid gap-3 md:grid-cols-[1fr_220px_auto]">
        <input
          name="q"
          defaultValue={searchText}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
          placeholder="Öğrenci veya veli ara..."
        />

        <select
          name="status"
          defaultValue={selectedStatus}
          className="rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
        >
          <option value="">Tüm durumlar</option>
          <option value="active">Aktif</option>
          <option value="frozen">Donduruldu</option>
          <option value="left">Ayrıldı</option>
          <option value="archived">Arşivlendi</option>
        </select>

        <button
          type="submit"
          className="rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-primary transition hover:bg-surface-muted"
        >
          Filtrele
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {students.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-surface-muted text-2xl">
              ◎
            </div>

            <h2 className="mt-5 text-lg font-bold">Öğrenci kaydı bulunamadı</h2>

            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
              İlk öğrenci kaydınızı oluşturarak gerçek verilerle çalışmaya başlayabilirsiniz.
            </p>

            <Link
              href="/ogrenciler/yeni"
              className="mt-6 inline-block rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary"
            >
              İlk öğrenciyi ekle
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-5 py-3">Öğrenci</th>
                  <th className="px-5 py-3">Birincil veli</th>
                  <th className="px-5 py-3">Telefon</th>
                  <th className="px-5 py-3">Kayıt tarihi</th>
                  <th className="px-5 py-3">Durum</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-primary-soft">
                {students.map((student) => {
                  const primaryGuardian =
                    student.student_guardians.find((item) => item.is_primary) ??
                    student.student_guardians[0] ??
                    null;

                  return (
                    <tr key={student.id} className="hover:bg-surface-muted">
                      <td className="px-5 py-4">
                        <Link
                          href={`/ogrenciler/${student.id}`}
                          className="font-semibold text-text-primary hover:underline"
                        >
                          {student.first_name} {student.last_name}
                        </Link>

                        {student.birth_date && (
                          <p className="mt-1 text-xs text-text-secondary">
                            Doğum: {formatDate(student.birth_date)}
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-4 text-text-secondary">
                        <p>{primaryGuardian?.guardian?.full_name ?? "Veli bilgisi yok"}</p>

                        {primaryGuardian?.relationship && (
                          <p className="mt-1 text-xs text-text-secondary">
                            {primaryGuardian.relationship}
                          </p>
                        )}
                      </td>

                      <td className="px-5 py-4 text-text-secondary">
                        {primaryGuardian?.guardian?.phone ?? "—"}
                      </td>

                      <td className="px-5 py-4 text-text-secondary">
                        {formatDate(student.registration_date)}
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            statusClasses[student.status]
                          }`}
                        >
                          {statusLabels[student.status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
