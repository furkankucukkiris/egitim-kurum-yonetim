-- Öğrenci bazlı, tarihli ücretlendirme + tahsilat tarihi.
--
-- Sorun: aylık ücret yalnızca kayıt anında enrollments satırına
-- yazılıyordu ve sonradan değiştirilemiyordu. Dersin
-- default_monthly_fee'si yalnızca kayıt formunu önceden doldurmak için
-- kullanılıyor; ama kurum her öğrenciye farklı ücret/indirim
-- uygulayabiliyor ve zamlar belirli bir aydan itibaren geçerli oluyor
-- (ör. "Ocak'tan itibaren %20 zam"). Dersin ücreti artık yalnızca MEB
-- onaylı ücret ilanı olarak bilgi amaçlı — tahakkuk her zaman öğrencinin
-- kendi ücret takviminden üretilir.
--
-- Tasarım:
--   1) enrollment_fee_changes: kayıt başına "şu aydan itibaren geçerli
--      ücret" satırları. Bir dönemin ücreti = effective_from <= dönem
--      olan EN SON satır. Mevcut her kayıt için başlangıç ayından
--      geçerli bir satır geri doldurulur; yeni kayıtlar trigger ile
--      kendi ilk satırını alır.
--   2) enrollments.list/discount/net sütunları "bugün geçerli ücret"
--      önbelleği olarak kalır (kayıt formu, ilk tahakkuk trigger'ı vb.
--      bunları okuyor). İleri tarihli bir değişiklik o ay geldiğinde
--      günlük otomasyon süpürmesi tarafından eşitlenir.
--   3) Ücret değişikliği kaydedildiğinde, o aydan itibaren (bir sonraki
--      değişikliğe kadar) zaten oluşturulmuş AÇIK tahakkuklar yeni
--      ücrete göre güncellenir. Tamamen ödenmiş dönemlere dokunulmaz;
--      yeni ücret o dönemde zaten tahsil edilenin altına düşüyorsa o
--      dönem de atlanır (sessizce fazla ödeme/iade doğurmamak için) —
--      atlanan sayısı kullanıcıya bildirilir.
--   4) record_payment_for_course tahsilat tarihini (p_received_on)
--      opsiyonel alır — geriye dönük tahsilat girilebilsin diye.

-- ---------------------------------------------------------------
-- 1) Ücret takvimi tablosu
-- ---------------------------------------------------------------

create table if not exists public.enrollment_fee_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enrollment_id uuid not null,
  effective_from date not null
    check (extract(day from effective_from) = 1),
  list_monthly_fee numeric(12,2) not null check (list_monthly_fee >= 0),
  discount_type text not null default 'none'
    check (discount_type in ('none', 'percent', 'fixed')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  net_monthly_fee numeric(12,2) not null check (net_monthly_fee >= 0),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, effective_from),
  constraint enrollment_fee_changes_enrollment_id_fkey
    foreign key (enrollment_id, organization_id)
    references public.enrollments (id, organization_id) on delete cascade,
  constraint enrollment_fee_changes_created_by_fkey
    foreign key (created_by, organization_id)
    references public.profiles (id, organization_id)
);

create index if not exists enrollment_fee_changes_org_idx
on public.enrollment_fee_changes (organization_id);

create index if not exists enrollment_fee_changes_created_by_idx
on public.enrollment_fee_changes (created_by);

drop trigger if exists enrollment_fee_changes_set_updated_at
on public.enrollment_fee_changes;

create trigger enrollment_fee_changes_set_updated_at
before update on public.enrollment_fee_changes
for each row execute function public.set_updated_at();

alter table public.enrollment_fee_changes enable row level security;

drop policy if exists enrollment_fee_changes_admin_select
on public.enrollment_fee_changes;

create policy enrollment_fee_changes_admin_select
on public.enrollment_fee_changes
for select
to authenticated
using (
  organization_id = (select public.current_organization_id())
  and (select public.can_manage_finance())
);

-- Yazma yalnızca aşağıdaki security definer RPC'ler üzerinden.
revoke all on public.enrollment_fee_changes from anon, authenticated;
grant select on public.enrollment_fee_changes to authenticated;

-- Mevcut kayıtlar için başlangıç satırı.
insert into public.enrollment_fee_changes (
  organization_id, enrollment_id, effective_from,
  list_monthly_fee, discount_type, discount_value, net_monthly_fee, note
)
select
  e.organization_id,
  e.id,
  pg_catalog.date_trunc('month', e.starts_on::timestamp)::date,
  e.list_monthly_fee,
  e.discount_type,
  e.discount_value,
  e.net_monthly_fee,
  'Kayıt ücreti'
from public.enrollments e
on conflict (enrollment_id, effective_from) do nothing;

-- Yeni kayıtlar kendi başlangıç satırını alır.
create or replace function public.create_initial_fee_change_for_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.enrollment_fee_changes (
    organization_id, enrollment_id, effective_from,
    list_monthly_fee, discount_type, discount_value, net_monthly_fee,
    note, created_by
  )
  values (
    new.organization_id,
    new.id,
    pg_catalog.date_trunc('month', new.starts_on::timestamp)::date,
    new.list_monthly_fee,
    new.discount_type,
    new.discount_value,
    new.net_monthly_fee,
    'Kayıt ücreti',
    (
      select p.id from public.profiles p
      where p.id = auth.uid() and p.organization_id = new.organization_id
    )
  )
  on conflict (enrollment_id, effective_from) do nothing;

  return new;
end;
$$;

revoke all on function public.create_initial_fee_change_for_enrollment()
from public, anon, authenticated;

drop trigger if exists enrollments_create_initial_fee_change
on public.enrollments;

create trigger enrollments_create_initial_fee_change
after insert on public.enrollments
for each row execute function public.create_initial_fee_change_for_enrollment();

-- ---------------------------------------------------------------
-- 2) Yardımcılar
-- ---------------------------------------------------------------

create or replace function public._compute_net_monthly_fee(
  p_list_monthly_fee numeric,
  p_discount_type text,
  p_discount_value numeric
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_list_monthly_fee is null or p_list_monthly_fee < 0 then
    raise exception 'Liste ücreti sıfırdan küçük olamaz.';
  end if;

  if p_discount_type not in ('none', 'percent', 'fixed') then
    raise exception 'Geçerli bir indirim türü seçilmelidir.';
  end if;

  if coalesce(p_discount_value, 0) < 0 then
    raise exception 'İndirim değeri sıfırdan küçük olamaz.';
  end if;

  if p_discount_type = 'none' then
    return round(p_list_monthly_fee, 2);
  elsif p_discount_type = 'percent' then
    if p_discount_value > 100 then
      raise exception 'Yüzde indirim 100 değerinden büyük olamaz.';
    end if;

    return round(p_list_monthly_fee - (p_list_monthly_fee * p_discount_value / 100), 2);
  end if;

  if p_discount_value > p_list_monthly_fee then
    raise exception 'Sabit indirim liste ücretinden büyük olamaz.';
  end if;

  return round(p_list_monthly_fee - p_discount_value, 2);
end;
$$;

revoke all on function public._compute_net_monthly_fee(numeric, text, numeric)
from public, anon, authenticated;

-- enrollments üzerindeki "bugün geçerli ücret" önbelleğini takvimle
-- eşitler. p_enrollment_id null ise kurumun tüm kayıtları.
create or replace function public._sync_enrollment_current_fees(
  p_organization_id uuid,
  p_enrollment_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date;
  v_updated integer;
begin
  v_month_start := pg_catalog.date_trunc(
    'month',
    (
      pg_catalog.now() at time zone coalesce(
        (select o.timezone from public.organizations o where o.id = p_organization_id),
        'Europe/Istanbul'
      )
    )
  )::date;

  with current_fee as (
    select distinct on (fc.enrollment_id)
      fc.enrollment_id,
      fc.list_monthly_fee,
      fc.discount_type,
      fc.discount_value,
      fc.net_monthly_fee
    from public.enrollment_fee_changes fc
    where fc.organization_id = p_organization_id
      and (p_enrollment_id is null or fc.enrollment_id = p_enrollment_id)
      and fc.effective_from <= v_month_start
    order by fc.enrollment_id, fc.effective_from desc
  ),
  updated as (
    update public.enrollments e
    set list_monthly_fee = cf.list_monthly_fee,
        discount_type = cf.discount_type,
        discount_value = cf.discount_value,
        net_monthly_fee = cf.net_monthly_fee
    from current_fee cf
    where e.id = cf.enrollment_id
      and e.organization_id = p_organization_id
      and (
        e.list_monthly_fee is distinct from cf.list_monthly_fee
        or e.discount_type is distinct from cf.discount_type
        or e.discount_value is distinct from cf.discount_value
        or e.net_monthly_fee is distinct from cf.net_monthly_fee
      )
    returning 1
  )
  select count(*)::integer into v_updated from updated;

  return v_updated;
end;
$$;

revoke all on function public._sync_enrollment_current_fees(uuid, uuid)
from public, anon, authenticated;

-- Tek bir kayıt için ücret değişikliğini uygular (çekirdek; yetki
-- kontrolü çağıran RPC'de).
create or replace function public._apply_enrollment_fee_change(
  p_organization_id uuid,
  p_actor_profile_id uuid,
  p_enrollment_id uuid,
  p_effective_from date,
  p_list_monthly_fee numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_note text
)
returns table (
  repriced_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective_from date;
  v_next_change date;
  v_starts_on date;
  v_discount_type text;
  v_discount_value numeric(12,2);
  v_net numeric(12,2);
  v_list numeric(12,2);
  v_repriced integer := 0;
  v_skipped integer := 0;
  v_change_id uuid;
begin
  if p_effective_from is null then
    raise exception 'Ücretin geçerli olacağı ay seçilmelidir.';
  end if;

  v_effective_from :=
    pg_catalog.date_trunc('month', p_effective_from::timestamp)::date;

  select e.starts_on
  into v_starts_on
  from public.enrollments e
  where e.id = p_enrollment_id
    and e.organization_id = p_organization_id
  for update;

  if v_starts_on is null then
    raise exception 'Ders kaydı bulunamadı.';
  end if;

  if v_effective_from < pg_catalog.date_trunc('month', v_starts_on::timestamp)::date then
    raise exception 'Ücret değişikliği kaydın başlangıç ayından önce olamaz.';
  end if;

  v_discount_type :=
    coalesce(nullif(pg_catalog.btrim(coalesce(p_discount_type, '')), ''), 'none');
  v_discount_value :=
    case when v_discount_type = 'none' then 0 else round(coalesce(p_discount_value, 0), 2) end;
  v_list := round(p_list_monthly_fee, 2);
  v_net := public._compute_net_monthly_fee(v_list, v_discount_type, v_discount_value);

  insert into public.enrollment_fee_changes (
    organization_id, enrollment_id, effective_from,
    list_monthly_fee, discount_type, discount_value, net_monthly_fee,
    note, created_by
  )
  values (
    p_organization_id, p_enrollment_id, v_effective_from,
    v_list, v_discount_type, v_discount_value, v_net,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), p_actor_profile_id
  )
  on conflict (enrollment_id, effective_from) do update
  set list_monthly_fee = excluded.list_monthly_fee,
      discount_type = excluded.discount_type,
      discount_value = excluded.discount_value,
      net_monthly_fee = excluded.net_monthly_fee,
      note = excluded.note,
      created_by = excluded.created_by
  returning id into v_change_id;

  -- Bu değişikliğin kapsadığı aralık: bir sonraki değişikliğe kadar.
  select min(fc.effective_from)
  into v_next_change
  from public.enrollment_fee_changes fc
  where fc.enrollment_id = p_enrollment_id
    and fc.effective_from > v_effective_from;

  with candidates as (
    select a.id, a.allocated_amount
    from public.accruals a
    where a.enrollment_id = p_enrollment_id
      and a.organization_id = p_organization_id
      and a.period_start >= v_effective_from
      and (v_next_change is null or a.period_start < v_next_change)
      and a.status in (
        'open'::public.accrual_status,
        'partial'::public.accrual_status,
        'overdue'::public.accrual_status
      )
      and (a.net_amount is distinct from v_net or a.gross_amount is distinct from v_list)
    for update
  ),
  repriced as (
    update public.accruals a
    set gross_amount = v_list,
        discount_amount = v_list - v_net,
        net_amount = v_net,
        status = case
          when a.allocated_amount >= v_net then 'paid'::public.accrual_status
          when a.allocated_amount > 0 then 'partial'::public.accrual_status
          else a.status
        end
    from candidates c
    where a.id = c.id
      and c.allocated_amount <= v_net
    returning 1
  )
  select
    (select count(*)::integer from repriced),
    (select count(*)::integer from candidates where allocated_amount > v_net)
  into v_repriced, v_skipped;

  perform public._sync_enrollment_current_fees(p_organization_id, p_enrollment_id);

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    p_organization_id, p_actor_profile_id, 'enrollment_fee_changes', v_change_id::text,
    'set_fee', null,
    pg_catalog.jsonb_build_object(
      'enrollment_id', p_enrollment_id,
      'effective_from', v_effective_from,
      'list_monthly_fee', v_list,
      'discount_type', v_discount_type,
      'discount_value', v_discount_value,
      'net_monthly_fee', v_net,
      'repriced_accruals', v_repriced,
      'skipped_accruals', v_skipped
    )
  );

  return query select v_repriced, v_skipped;
end;
$$;

revoke all on function public._apply_enrollment_fee_change(
  uuid, uuid, uuid, date, numeric, text, numeric, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 3) Public RPC'ler
-- ---------------------------------------------------------------

create or replace function public.set_enrollment_fee(
  p_enrollment_id uuid,
  p_effective_from date,
  p_list_monthly_fee numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_note text default null
)
returns table (
  repriced_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception 'Ücret değiştirme yetkiniz bulunmuyor.';
  end if;

  return query
  select *
  from public._apply_enrollment_fee_change(
    v_organization_id, v_user_id, p_enrollment_id, p_effective_from,
    p_list_monthly_fee, p_discount_type, p_discount_value, p_note
  );
end;
$$;

revoke all on function public.set_enrollment_fee(uuid, date, numeric, text, numeric, text)
from public, anon;
grant execute on function public.set_enrollment_fee(uuid, date, numeric, text, numeric, text)
to authenticated;

-- Bir dersteki tüm aktif/dondurulmuş kayıtlara toplu zam (veya
-- indirim). Her öğrencinin o aydaki KENDİ liste ücretine uygulanır;
-- öğrencinin indirimi korunur (sabit indirim yeni liste ücretini
-- aşıyorsa liste ücretine eşitlenir).
create or replace function public.bulk_adjust_course_fees(
  p_course_id uuid,
  p_effective_from date,
  p_adjust_type text,
  p_adjust_value numeric,
  p_note text default null
)
returns table (
  enrollment_count integer,
  repriced_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_effective_from date;
  v_row record;
  v_new_list numeric(12,2);
  v_discount_value numeric(12,2);
  v_result record;
  v_enrollments integer := 0;
  v_repriced integer := 0;
  v_skipped integer := 0;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception 'Ücret değiştirme yetkiniz bulunmuyor.';
  end if;

  if p_effective_from is null then
    raise exception 'Ücretin geçerli olacağı ay seçilmelidir.';
  end if;

  if p_adjust_type not in ('percent', 'fixed') then
    raise exception 'Geçerli bir artış türü seçilmelidir.';
  end if;

  if p_adjust_value is null or p_adjust_value = 0 then
    raise exception 'Artış değeri sıfırdan farklı olmalıdır.';
  end if;

  if p_adjust_type = 'percent' and p_adjust_value <= -100 then
    raise exception 'Yüzde değişim -100 veya daha küçük olamaz.';
  end if;

  if not exists (
    select 1 from public.courses c
    where c.id = p_course_id and c.organization_id = v_organization_id
  ) then
    raise exception 'Ders bulunamadı.';
  end if;

  v_effective_from :=
    pg_catalog.date_trunc('month', p_effective_from::timestamp)::date;

  for v_row in
    select
      e.id,
      fc.list_monthly_fee,
      fc.discount_type,
      fc.discount_value
    from public.enrollments e
    cross join lateral (
      select f.list_monthly_fee, f.discount_type, f.discount_value
      from public.enrollment_fee_changes f
      where f.enrollment_id = e.id
        and f.effective_from <= greatest(
          v_effective_from,
          pg_catalog.date_trunc('month', e.starts_on::timestamp)::date
        )
      order by f.effective_from desc
      limit 1
    ) fc
    where e.organization_id = v_organization_id
      and e.course_id = p_course_id
      and e.status in ('active'::public.enrollment_status, 'frozen'::public.enrollment_status)
      and (e.ends_on is null or e.ends_on >= v_effective_from)
    order by e.id
  loop
    v_new_list := case
      when p_adjust_type = 'percent'
        then round(v_row.list_monthly_fee * (1 + p_adjust_value / 100), 2)
      else round(v_row.list_monthly_fee + p_adjust_value, 2)
    end;

    if v_new_list < 0 then
      raise exception 'Toplu değişiklik bazı öğrencilerin ücretini sıfırın altına düşürüyor.';
    end if;

    v_discount_value := case
      when v_row.discount_type = 'fixed'
        then least(v_row.discount_value, v_new_list)
      else v_row.discount_value
    end;

    select * into v_result
    from public._apply_enrollment_fee_change(
      v_organization_id, v_user_id, v_row.id,
      greatest(v_effective_from, (
        select pg_catalog.date_trunc('month', e2.starts_on::timestamp)::date
        from public.enrollments e2 where e2.id = v_row.id
      )),
      v_new_list, v_row.discount_type, v_discount_value,
      coalesce(
        nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
        'Toplu ücret güncellemesi'
      )
    );

    v_enrollments := v_enrollments + 1;
    v_repriced := v_repriced + v_result.repriced_count;
    v_skipped := v_skipped + v_result.skipped_count;
  end loop;

  return query select v_enrollments, v_repriced, v_skipped;
end;
$$;

revoke all on function public.bulk_adjust_course_fees(uuid, date, text, numeric, text)
from public, anon;
grant execute on function public.bulk_adjust_course_fees(uuid, date, text, numeric, text)
to authenticated;

-- ---------------------------------------------------------------
-- 4) Aylık tahakkuk üretimi ücret takviminden okur
-- ---------------------------------------------------------------

create or replace function
public._generate_monthly_accruals_for_org(
  p_organization_id uuid,
  p_month_start date,
  p_actor_profile_id uuid
)
returns table (
  created_count integer,
  existing_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date;
  v_month_end date;
  v_expected_count integer := 0;
  v_created_count integer := 0;
begin
  if p_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if p_month_start is null then
    raise exception
      'Tahakkukların oluşturulacağı ay seçilmelidir.';
  end if;

  v_month_start :=
    pg_catalog.date_trunc('month', p_month_start::timestamp)::date;

  v_month_end :=
    (
      pg_catalog.date_trunc('month', p_month_start::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':accrual:' || v_month_start::text,
      2026080812
    )
  );

  select count(*)::integer
  into v_expected_count
  from public.enrollments e
  where e.organization_id = p_organization_id
    and e.status = 'active'::public.enrollment_status
    and e.starts_on <= v_month_end
    and (e.ends_on is null or e.ends_on >= v_month_start);

  with inserted as (
    insert into public.accruals (
      organization_id,
      enrollment_id,
      student_id,
      period_start,
      due_date,
      description,
      gross_amount,
      discount_amount,
      net_amount,
      status
    )
    select
      e.organization_id,
      e.id,
      e.student_id,
      v_month_start,
      least(
        (v_month_start + ((e.due_day - 1) || ' days')::interval)::date,
        v_month_end
      ),
      public.tr_month_name(extract(month from v_month_start)::integer)
        || ' ' || extract(year from v_month_start)::text || ' aidatı',
      coalesce(fc.list_monthly_fee, e.list_monthly_fee),
      coalesce(fc.list_monthly_fee, e.list_monthly_fee)
        - coalesce(fc.net_monthly_fee, e.net_monthly_fee),
      coalesce(fc.net_monthly_fee, e.net_monthly_fee),
      'open'::public.accrual_status
    from public.enrollments e
    left join lateral (
      select f.list_monthly_fee, f.net_monthly_fee
      from public.enrollment_fee_changes f
      where f.enrollment_id = e.id
        and f.effective_from <= v_month_start
      order by f.effective_from desc
      limit 1
    ) fc on true
    where e.organization_id = p_organization_id
      and e.status = 'active'::public.enrollment_status
      and e.starts_on <= v_month_end
      and (e.ends_on is null or e.ends_on >= v_month_start)
    on conflict (enrollment_id, period_start) do nothing
    returning 1
  )
  select count(*)::integer into v_created_count from inserted;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    p_organization_id, p_actor_profile_id, 'accruals', v_month_start::text,
    'generate_month', null,
    pg_catalog.jsonb_build_object(
      'month_start', v_month_start,
      'month_end', v_month_end,
      'created_count', v_created_count,
      'existing_count', greatest(v_expected_count - v_created_count, 0)
    )
  );

  return query
  select v_created_count, greatest(v_expected_count - v_created_count, 0);
end;
$$;

revoke all on function
public._generate_monthly_accruals_for_org(uuid, date, uuid)
from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 5) Günlük süpürme: ileri tarihli ücretler ayı gelince önbelleğe
-- ---------------------------------------------------------------

create or replace function public.run_daily_automation_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_local_today date;
  v_next_month_start date;
begin
  -- Ücret önbelleği otomasyon açık/kapalı fark etmeksizin eşitlenir.
  for v_org in select id from public.organizations
  loop
    perform public._sync_enrollment_current_fees(v_org.id, null);
  end loop;

  for v_org in
    select
      id,
      timezone,
      sessions_generation_day,
      accruals_generation_day
    from public.organizations
    where monthly_automation_enabled = true
  loop
    v_local_today :=
      (
        pg_catalog.now()
        at time zone coalesce(v_org.timezone, 'Europe/Istanbul')
      )::date;

    v_next_month_start :=
      (
        pg_catalog.date_trunc('month', v_local_today::timestamp)
        + interval '1 month'
      )::date;

    if extract(day from v_local_today)::integer
         = v_org.sessions_generation_day
       and not exists (
         select 1 from public.automation_job_runs
         where organization_id = v_org.id
           and job_type = 'lesson_sessions'::public.automation_job_type
           and period = v_next_month_start
           and status = 'succeeded'
       )
    then
      perform public.run_monthly_automation_job(
        v_org.id,
        'lesson_sessions'::public.automation_job_type,
        v_next_month_start,
        'schedule',
        null
      );
    end if;

    if extract(day from v_local_today)::integer
         = v_org.accruals_generation_day
       and not exists (
         select 1 from public.automation_job_runs
         where organization_id = v_org.id
           and job_type = 'accruals'::public.automation_job_type
           and period = v_next_month_start
           and status = 'succeeded'
       )
    then
      perform public.run_monthly_automation_job(
        v_org.id,
        'accruals'::public.automation_job_type,
        v_next_month_start,
        'schedule',
        null
      );
    end if;
  end loop;
end;
$$;

revoke all on function public.run_daily_automation_sweep()
from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 6) Tahsilat tarihi (geriye dönük tahsilat girişi)
-- ---------------------------------------------------------------

drop function if exists
public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid);

create or replace function public.record_payment_for_course(
  p_student_id uuid,
  p_course_id uuid,
  p_amount numeric,
  p_method text,
  p_note text,
  p_cash_account_id uuid default null,
  p_received_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_payment_id uuid;
  v_cash_movement_id uuid;
  v_remaining numeric(12,2);
  v_accrual record;
  v_allocate numeric(12,2);
  v_receipt_counter integer;
  v_receipt_number text;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_received_at timestamptz;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Ödeme kaydetme yetkiniz bulunmuyor.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception
      'Geçerli bir tutar girilmelidir.';
  end if;

  if p_method not in
    ('cash', 'bank_transfer', 'card', 'online', 'other') then
    raise exception
      'Geçerli bir ödeme yöntemi seçilmelidir.';
  end if;

  if p_received_on is not null and p_received_on > v_today then
    raise exception 'Tahsilat tarihi ileri bir tarih olamaz.';
  end if;

  -- Bugün (veya boş) ise gerçek kayıt anı; geçmiş bir gün ise o günün
  -- öğlesi (İstanbul) — ay sınırı kaymasın diye.
  v_received_at := case
    when p_received_on is null or p_received_on = v_today then pg_catalog.now()
    else (p_received_on::timestamp + interval '12 hours') at time zone 'Europe/Istanbul'
  end;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.organization_id = v_organization_id
  ) then
    raise exception 'Öğrenci kaydı bulunamadı.';
  end if;

  if not exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id
      and e.course_id = p_course_id
      and e.organization_id = v_organization_id
  ) then
    raise exception 'Öğrencinin bu derste kaydı bulunamadı.';
  end if;

  if p_method = 'cash' then
    if p_cash_account_id is null then
      raise exception
        'Nakit ödeme için bir kasa hesabı seçilmelidir.';
    end if;

    if not exists (
      select 1 from public.cash_accounts
      where id = p_cash_account_id
        and organization_id = v_organization_id
        and is_active = true
    ) then
      raise exception 'Kasa hesabı bulunamadı.';
    end if;
  end if;

  update public.organizations
  set next_receipt_number = next_receipt_number + 1
  where id = v_organization_id
  returning next_receipt_number - 1 into v_receipt_counter;

  v_receipt_number :=
    pg_catalog.to_char(pg_catalog.now() at time zone 'Europe/Istanbul', 'YYYY')
    || '-' || pg_catalog.lpad(v_receipt_counter::text, 6, '0');

  insert into public.payments (
    organization_id, student_id, course_id, received_at, amount, method,
    note, recorded_by, receipt_number
  )
  values (
    v_organization_id, p_student_id, p_course_id, v_received_at, p_amount,
    p_method::public.payment_method,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    v_user_id, v_receipt_number
  )
  returning id into v_payment_id;

  if p_method = 'cash' then
    insert into public.cash_movements (
      organization_id, cash_account_id, movement_type, amount, direction,
      occurred_at, payment_id, note, recorded_by
    )
    values (
      v_organization_id, p_cash_account_id, 'cash_in'::public.cash_movement_type,
      p_amount, 1, v_received_at, v_payment_id,
      nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), v_user_id
    )
    returning id into v_cash_movement_id;
  end if;

  v_remaining := p_amount;

  for v_accrual in
    select a.id, (a.net_amount - a.allocated_amount) as pending
    from public.accruals a
    inner join public.enrollments e on e.id = a.enrollment_id
    where a.organization_id = v_organization_id
      and e.student_id = p_student_id
      and e.course_id = p_course_id
      and a.status in (
        'open'::public.accrual_status,
        'partial'::public.accrual_status,
        'overdue'::public.accrual_status
      )
    order by a.period_start asc
    for update of a
  loop
    exit when v_remaining <= 0;

    v_allocate := least(v_remaining, v_accrual.pending);

    if v_allocate > 0 then
      insert into public.payment_allocations (
        organization_id, payment_id, accrual_id, amount
      )
      values (
        v_organization_id, v_payment_id, v_accrual.id, v_allocate
      );

      update public.accruals
      set allocated_amount = allocated_amount + v_allocate,
          status = case
            when allocated_amount + v_allocate >= net_amount
              then 'paid'::public.accrual_status
            else 'partial'::public.accrual_status
          end
      where id = v_accrual.id;

      v_remaining := v_remaining - v_allocate;
    end if;
  end loop;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'payments', v_payment_id::text,
    'create', null,
    pg_catalog.jsonb_build_object(
      'student_id', p_student_id,
      'course_id', p_course_id,
      'amount', p_amount,
      'method', p_method,
      'received_at', v_received_at,
      'receipt_number', v_receipt_number,
      'unallocated_remainder', v_remaining,
      'cash_movement_id', v_cash_movement_id
    )
  );

  return v_payment_id;
end;
$$;

revoke all on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid, date)
from public, anon;
grant execute on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid, date)
to authenticated;

notify pgrst, 'reload schema';
