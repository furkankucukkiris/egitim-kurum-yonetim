-- WhatsApp ödeme hatırlatma botu için kurum ayarları. Botun kendisi
-- henüz yok — burada yalnızca mesaj şablonu ve gönderim günü
-- saklanır, ileride gönderim işini yapacak sürece kaynak olacak.

alter table public.organizations
add column if not exists whatsapp_reminder_day smallint
  not null default 15
  check (whatsapp_reminder_day between 1 and 28);

alter table public.organizations
add column if not exists whatsapp_reminder_template text
  not null default
    'Merhaba {veli_adi}, {ogrenci_adi} için {ay_yili} ayına ait {tutar} tutarındaki ödemenizi henüz alamadık. En kısa sürede tarafımıza iletmenizi rica ederiz. {kurum_adi}';

notify pgrst, 'reload schema';
