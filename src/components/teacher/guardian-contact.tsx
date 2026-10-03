// Öğretmen ekranlarında veli iletişim bilgisi. Veriler
// get_teacher_student_contacts() RPC'sinden gelir; yalnızca öğretmenin
// kendi aktif/dondurulmuş öğrencilerinin veli adı ve telefonlarını içerir.

export type GuardianContact = {
  student_id: string;
  guardian_full_name: string;
  relationship: string | null;
  phone: string | null;
  secondary_phone: string | null;
  is_primary: boolean;
};

export function groupContactsByStudent(contacts: GuardianContact[]) {
  const byStudent = new Map<string, GuardianContact[]>();

  for (const contact of contacts) {
    const list = byStudent.get(contact.student_id) ?? [];
    list.push(contact);
    byStudent.set(contact.student_id, list);
  }

  return byStudent;
}

export function GuardianContactList({
  contacts,
  compact = false,
}: {
  contacts: GuardianContact[] | undefined;
  compact?: boolean;
}) {
  if (!contacts || contacts.length === 0) {
    return <p className="text-xs text-text-secondary">Veli bilgisi yok</p>;
  }

  const visible = compact ? contacts.slice(0, 1) : contacts;

  return (
    <div className="space-y-1.5">
      {visible.map((contact, index) => (
        <div key={`${contact.guardian_full_name}-${index}`} className="text-sm">
          <p className="font-medium">
            {contact.guardian_full_name}
            {contact.relationship && (
              <span className="ml-1 text-xs font-normal text-text-secondary">
                ({contact.relationship})
              </span>
            )}
          </p>

          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {contact.phone && <PhoneLink phone={contact.phone} />}
            {contact.secondary_phone && <PhoneLink phone={contact.secondary_phone} />}
          </div>
        </div>
      ))}
    </div>
  );
}

function PhoneLink({ phone }: { phone: string }) {
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
    >
      {phone}
    </a>
  );
}
