// Denetim kaydı ekranı için Türkçe etiketler. Yeni bir tablo/alan
// eklendiğinde burayı güncellemek yeterli — ekran kodu değişmez.
// Sözlükte olmayan anahtarlar humanizeKey() ile makul bir başlığa
// çevrilir, sözlükte olmayan tablo/aksiyon adları oldukları gibi
// gösterilir (hiçbir zaman gizlenmez/atılmaz).

export const tableLabels: Record<string, string> = {
  students: "Öğrenciler",
  guardians: "Veliler",
  student_guardians: "Öğrenci-Veli Bağlantısı",
  courses: "Dersler",
  class_groups: "Ders Programları",
  enrollments: "Kayıtlar",
  lesson_sessions: "Ders Oturumları",
  attendance: "Yoklama",
  makeup_credits: "Telafi Hakları",
  session_change_requests: "Oturum Değişiklik Talepleri",
  accruals: "Tahakkuklar",
  payments: "Ödemeler",
  payment_allocations: "Ödeme Dağıtımları",
  payment_refunds: "İadeler",
  payment_refund_allocations: "İade Dağıtımları",
  cash_accounts: "Kasa Hesapları",
  bank_accounts: "Banka Hesapları",
  cash_movements: "Kasa Hareketleri",
  bank_deposits: "Banka Yatırımları",
  bank_deposit_items: "Yatırım Kalemleri",
  expense_categories: "Masraf Kategorileri",
  expenses: "Masraflar",
  recurring_expense_templates: "Tekrarlayan Masraf Şablonları",
  teacher_compensation_rules: "Hakediş Kuralları",
  teacher_work_logs: "Hakediş Kayıtları",
  automation_job_runs: "Otomasyon Çalışmaları",
  profiles: "Kullanıcı Hesapları",
  organizations: "Kurum Ayarları",
  teacher_course_meb_authorizations: "MEB Ders Yetkileri",
  enrollment_meb_registrations: "MEB Kayıtları",
  message_templates: "Mesaj Şablonları",
  outbound_messages: "Giden Mesajlar",
  delivery_attempts: "Gönderim Denemeleri",
  prospects: "Aday Öğrenciler",
  prospect_course_interests: "Aday Öğrenci Ders İlgisi",
  waitlist_entries: "Bekleme Listesi",
};

export const actionLabels: Record<string, string> = {
  create: "Oluşturuldu",
  update: "Güncellendi",
  archive: "Arşivlendi",
  cancel: "İptal edildi",
  cancel_session: "Oturum iptal edildi",
  reschedule_session: "Oturum yeniden planlandı",
  generate_month: "Aylık üretim",
  set_photo: "Fotoğraf değiştirildi",
  set_document: "Belge eklendi",
  set_receipt: "Makbuz eklendi",
  set_active: "Durum değiştirildi",
  reverse: "Ters kayıt oluşturuldu",
  refund: "İade edildi",
  record_payment: "Ödeme kaydedildi",
  cash_count_adjustment: "Kasa sayım düzeltmesi",
  approve: "Onaylandı",
  mark_paid: "Ödendi işaretlendi",
  add_adjustment: "Düzeltme eklendi",
  end_rule: "Kural sonlandırıldı",
  institution_cancelled: "Kurum tarafından iptal edildi",
  makeup_scheduled: "Telafi planlandı",
  request_reviewed: "Talep değerlendirildi",
  unlock_attendance: "Yoklama kilidi açıldı",
  retry: "Tekrar denendi",
  send: "Gönderildi",
  send_failed: "Gönderim başarısız",
  update_status: "Durum güncellendi",
  schedule_trial: "Deneme dersi planlandı",
  cancel_trial: "Deneme dersi iptal edildi",
  convert: "Öğrenciye dönüştürüldü",
  offer: "Teklif verildi",
  resolve_offer: "Teklif yanıtlandı",
  enroll: "Derse kaydedildi",
};

export const fieldLabels: Record<string, string> = {
  first_name: "Ad",
  last_name: "Soyad",
  full_name: "Ad Soyad",
  birth_date: "Doğum tarihi",
  registration_date: "Kayıt tarihi",
  notes: "Notlar",
  note: "Not",
  status: "Durum",
  phone: "Telefon",
  secondary_phone: "İkinci telefon",
  email: "E-posta",
  relationship: "Yakınlık",
  may_receive_financial_messages: "Finansal mesaj alabilir",
  exit_date: "Çıkış tarihi",
  exit_reason: "Çıkış nedeni",
  amount: "Tutar",
  method: "Yöntem",
  payment_method: "Ödeme yöntemi",
  unallocated_remainder: "Dağıtılmamış tutar",
  cash_movement_id: "Kasa hareketi",
  category_id: "Kategori",
  course_id: "Ders",
  cash_account_id: "Kasa hesabı",
  bank_account_id: "Banka hesabı",
  vendor_name: "Tedarikçi",
  expense_date: "Masraf tarihi",
  due_date: "Vade tarihi",
  paid_at: "Ödeme tarihi",
  reason: "Gerekçe",
  cancellation_reason: "İptal gerekçesi",
  cancellation_kind: "İptal türü",
  month_start: "Ay başlangıcı",
  month_end: "Ay bitişi",
  period_start: "Dönem",
  created_count: "Oluşturulan sayısı",
  existing_count: "Mevcut sayısı",
  skipped_group_count: "Atlanan program sayısı",
  skipped_no_rule_count: "Kural bulunamadığı için atlanan",
  delta: "Fark",
  previous_balance: "Önceki bakiye",
  counted_amount: "Sayılan tutar",
  movement_count: "Hareket sayısı",
  movement_id: "Hareket",
  reverses_movement_id: "Ters kaydı yapılan hareket",
  deposited_by: "Yatıran",
  receipt_path: "Makbuz",
  document_path: "Belge",
  photo_path: "Fotoğraf",
  discount_type: "İndirim türü",
  discount_value: "İndirim tutarı",
  list_monthly_fee: "Liste ücreti",
  net_monthly_fee: "Net ücret",
  due_day: "Vade günü",
  starts_on: "Başlangıç tarihi",
  ends_on: "Bitiş tarihi",
  weekday: "Haftanın günü",
  start_time: "Başlangıç saati",
  duration_minutes: "Süre (dakika)",
  room_name: "Derslik",
  capacity: "Kontenjan",
  teacher_profile_id: "Öğretmen",
  student_id: "Öğrenci",
  approved_count: "Onaylanan sayısı",
  paid_count: "Ödenen sayısı",
  is_active: "Aktif",
  is_direct_course_cost: "Ders maliyeti mi",
  compensation_type: "Ücret modeli",
  rate_amount: "Tutar",
  effective_from: "Başlangıç",
  effective_to: "Bitiş",
  direction: "Yön",
  scenario: "Senaryo",
  name: "Ad",
  logo_path: "Logo",
  legal_name: "Resmi unvan",
  tax_number: "Vergi numarası",
  whatsapp_reminder_day: "WhatsApp hatırlatma günü",
  monthly_automation_enabled: "Otomasyon aktif mi",
  sessions_generation_day: "Oturum üretim günü",
  accruals_generation_day: "Tahakkuk üretim günü",
  refund_type: "İade türü",
  event_type: "Olay türü",
  body_template: "Şablon metni",
  is_financial: "Finansal mi",
  recipient_phone: "Alıcı telefonu",
  provider: "Sağlayıcı",
  error_code: "Hata kodu",
  guardian_id: "Veli",
  student_first_name: "Öğrenci adı",
  student_last_name: "Öğrenci soyadı",
  guardian_name: "Veli adı",
  lead_source: "Kaynak",
  decline_reason: "Reddetme nedeni",
  next_follow_up_date: "Sonraki takip tarihi",
  initial_contact_date: "İlk iletişim tarihi",
  assigned_profile_id: "Atanan personel",
  converted_student_id: "Dönüştürülen öğrenci",
  prospect_id: "Aday öğrenci",
  starts_at: "Başlangıç",
  ends_at: "Bitiş",
  priority: "Öncelik",
  application_date: "Başvuru tarihi",
  preferred_weekdays: "Tercih edilen günler",
  preferred_time_start: "Tercih edilen başlangıç saati",
  preferred_time_end: "Tercih edilen bitiş saati",
  offer_expires_at: "Teklif geçerlilik süresi",
  converted_enrollment_id: "Oluşturulan kayıt",
  class_group_id: "Ders seansı",
};

// Bu anahtarlar hangi tabloda/hangi payload'da görünürse görünsün,
// değer HER ZAMAN maskelenir — kaynak koddaki tek tek jsonb_build_object
// çağrılarına güvenmek yerine, ekranın kendisi de bağımsız bir savunma
// katmanı olsun diye. Ders kimlik/vergi no gibi alanlar zaten hiçbir
// audit_logs satırına yazılmıyor (bkz. README, "Denetim kaydı" bölümü)
// ama bu liste ileride yanlışlıkla eklenecek bir alana karşı da korur.
const SENSITIVE_KEY_PATTERN =
  /identity_number|tckn|kimlik|password|sifre|parola|token|service_role|secret|api_key/i;

export function isSensitiveAuditKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function tableLabel(tableName: string): string {
  return tableLabels[tableName] ?? humanizeKey(tableName);
}

export function actionLabel(action: string): string {
  return actionLabels[action] ?? humanizeKey(action);
}

export function fieldLabel(key: string): string {
  return fieldLabels[key] ?? humanizeKey(key);
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (char) => char.toUpperCase());
}

export function formatAuditValue(key: string, value: unknown): string {
  if (isSensitiveAuditKey(key)) {
    return "••••••••";
  }

  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Evet" : "Hayır";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}
