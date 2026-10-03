import { PageHeader } from "@/components/page-header";
import {
  type GuardianContact,
  GuardianContactList,
  groupContactsByStudent,
} from "@/components/teacher/guardian-contact";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// get_teacher_enrollments() satırının bu sayfada kullanılan kısmı.
type TeacherEnrollmentRpcRow = {
  id: string;
  student_id: string;
  status: "active" | "frozen";
  student_first_name: string;
  student_last_name: string;
  course_name: string | null;
  class_group_name: string | null;
  class_group_weekday: number | null;
  class_group_start_time: string | null;
};

type StudentSummary = {
  id: string;
  name: string;
  enrollments: TeacherEnrollmentRpcRow[];
};

const weekdayLabels: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

export default async function TeacherStudentsPage() {
  await requireRole(["teacher"]);

  const supabase = await createClient();

  const [enrollmentsResult, contactsResult] = await Promise.all([
    supabase.rpc("get_teacher_enrollments").in("status", ["active", "frozen"]),
    supabase.rpc("get_teacher_student_contacts"),
  ]);

  if (enrollmentsResult.error) {
    console.error("Öğretmen öğrencileri alınamadı:", enrollmentsResult.error);
  }

  if (contactsResult.error) {
    console.error("Veli iletişim bilgileri alınamadı:", contactsResult.error);
  }

  const contactsByStudent = groupContactsByStudent(
    (contactsResult.data ?? []) as GuardianContact[],
  );

  const studentsById = new Map<string, StudentSummary>();

  for (const row of (enrollmentsResult.data ?? []) as unknown as TeacherEnrollmentRpcRow[]) {
    const student = studentsById.get(row.student_id) ?? {
      id: row.student_id,
      name: `${row.student_first_name} ${row.student_last_name}`,
      enrollments: [],
    };

    student.enrollments.push(row);
    studentsById.set(row.student_id, student);
  }

  const students = Array.from(studentsById.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "tr-TR"),
  );

  return (
    <>
      <PageHeader
        title="Öğrencilerim"
        description="Size kayıtlı tüm öğrenciler, aldıkları dersler ve velilerinin iletişim bilgileri."
      />

      {(enrollmentsResult.error || contactsResult.error) && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Öğrenci listesinin bir kısmı alınamadı.
        </div>
      )}

      {students.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-text-secondary">
          Size atanmış aktif bir öğrenci kaydı bulunmuyor.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-sm">
              <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="w-12 px-4 py-3">#</th>
                  <th className="px-5 py-3">Öğrenci</th>
                  <th className="px-5 py-3">Ders ve seans</th>
                  <th className="px-5 py-3">Veli ve telefon</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-primary-soft">
                {students.map((student, index) => (
                  <tr key={student.id} className="align-top hover:bg-surface-muted">
                    <td className="px-4 py-4 text-text-secondary">{index + 1}</td>

                    <td className="px-5 py-4 font-semibold">{student.name}</td>

                    <td className="space-y-2 px-5 py-4">
                      {student.enrollments.map((enrollment) => (
                        <div key={enrollment.id}>
                          <p className="font-medium">
                            {enrollment.course_name ?? "Ders bilgisi yok"}
                            {enrollment.status === "frozen" && (
                              <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">
                                Donduruldu
                              </span>
                            )}
                          </p>

                          <p className="text-xs text-text-secondary">
                            {enrollment.class_group_name ?? "Seans belirtilmedi"}
                            {enrollment.class_group_weekday != null &&
                              enrollment.class_group_start_time &&
                              ` · ${weekdayLabels[enrollment.class_group_weekday]} ${enrollment.class_group_start_time.slice(0, 5)}`}
                          </p>
                        </div>
                      ))}
                    </td>

                    <td className="px-5 py-4">
                      <GuardianContactList contacts={contactsByStudent.get(student.id)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
