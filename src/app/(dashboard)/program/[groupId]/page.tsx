import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClassGroupForm } from "../class-group-form";

type PageProps = {
  params: Promise<{
    groupId: string;
  }>;
};

type GroupRow = {
  id: string;
  course_id: string;
  teacher_profile_id: string | null;
  name: string;
  room_name: string | null;
  capacity: number;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  starts_on: string;
  ends_on: string | null;

  course: {
    name: string;
    course_type: "individual" | "group";
    default_duration_minutes: number;
  } | null;
};

type TeacherRow = {
  id: string;
  full_name: string;
};

export default async function EditClassGroupPage({ params }: PageProps) {
  await requireRole(["admin"]);

  const { groupId } = await params;
  const supabase = await createClient();

  const [groupResult, teachersResult] = await Promise.all([
    supabase
      .from("class_groups")
      .select(
        `
          id,
          course_id,
          teacher_profile_id,
          name,
          room_name,
          capacity,
          weekday,
          start_time,
          duration_minutes,
          starts_on,
          ends_on,
          course:courses (
            name,
            course_type,
            default_duration_minutes
          )
        `,
      )
      .eq("id", groupId)
      .maybeSingle(),

    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .eq("role", "teacher")
      .order("full_name"),
  ]);

  if (groupResult.error) {
    console.error("Ders seansı alınamadı:", groupResult.error);
  }

  if (!groupResult.data) {
    notFound();
  }

  const group = groupResult.data as unknown as GroupRow;

  const teachers = (teachersResult.data ?? []) as TeacherRow[];

  if (!group.course) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={`${group.name} Seansını Düzenle`}
        description="Ders günü, saati, öğretmeni, süresi ve kapasitesini güncelleyin."
      />

      <ClassGroupForm
        mode="edit"
        courses={[]}
        teachers={teachers.map((teacher) => ({
          id: teacher.id,
          fullName: teacher.full_name,
        }))}
        group={{
          id: group.id,
          courseId: group.course_id,
          courseName: group.course.name,
          courseType: group.course.course_type,
          name: group.name,
          teacherProfileId: group.teacher_profile_id ?? "",
          roomName: group.room_name ?? "",
          capacity: group.capacity,
          weekday: group.weekday,
          startTime: group.start_time.slice(0, 5),
          durationMinutes: group.duration_minutes,
          startsOn: group.starts_on,
          endsOn: group.ends_on ?? "",
        }}
      />
    </>
  );
}
