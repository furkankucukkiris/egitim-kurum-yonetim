-- MEB logosu kurumdan kuruma değişmiyor; kurum ayarlarından yüklenebilir
-- bir kaynak olmak yerine `public/logos/meb-logo.png` altında statik
-- dosya olarak sunuluyor. Bu sütun hiç kullanılmadan kaldırılıyor.

alter table public.organizations
drop column if exists meb_logo_path;

notify pgrst, 'reload schema';
