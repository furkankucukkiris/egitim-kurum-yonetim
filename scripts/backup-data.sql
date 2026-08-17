-- ============================================================
-- Docker/pg_dump GEREKTİRMEYEN veri yedeği
-- ============================================================
-- `supabase db dump` (ve yerel `pg_dump`) Docker ister; Docker
-- kullanılmayan ortamlarda bu betik onun yerine geçer. `public`
-- şemasındaki TÜM tabloları (yapı değişse bile otomatik keşfederek)
-- tek bir JSON belgesi olarak dışa aktarır.
--
-- Kullanım:
--   supabase db query --linked --file scripts/backup-data.sql > yedek-$(date +%Y%m%d).json
--
-- Not: `auth.*` (kullanıcı/MFA) ve `storage.*` (dosya blob'ları) bu
-- betiğin kapsamı DIŞINDA — yalnızca `public` şemasındaki iş verisini
-- yedekler. Kimlik doğrulama/MFA verisinin bu yöntemle birebir geri
-- yüklenemediği 2026-08-17 tatbikatında doğrulanmıştır, bkz. aşağıdaki
-- "2026-08-17 tatbikatı" notu.
-- ============================================================

create or replace function pg_temp.backup_public_schema()
returns jsonb
language plpgsql
as $$
declare
  tbl text;
  result jsonb := '{}'::jsonb;
  data jsonb;
begin
  for tbl in
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t', tbl) into data;
    result := result || jsonb_build_object(tbl, data);
  end loop;
  return result;
end;
$$;

select pg_temp.backup_public_schema() as backup;
