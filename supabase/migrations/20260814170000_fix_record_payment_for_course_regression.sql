-- Regresyon düzeltmesi: 20260812130000_add_cash_bank_module.sql,
-- record_payment_for_course()'u kasa hesabı entegrasyonu eklerken
-- yeniden yazmış ve 20260811130000'de eklenmiş olan `course_id` ile
-- `receipt_number` sütunlarını INSERT listesinden DÜŞÜRMÜŞ —
-- fonksiyon hâlâ çalışıyor (hata vermiyor) ama o tarihten sonra
-- kaydedilen HER ödemenin `course_id`'si ve `receipt_number`'ı null
-- kalıyor. Bu, `get_payment_detail()`'in ders adını göstermesini ve
-- `/odemeler/[paymentId]` sayfasının makbuz numarasını göstermesini
-- sessizce bozuyordu (bkz. src/app/(dashboard)/odemeler/[paymentId]/page.tsx).
--
-- Bu, otomatik test altyapısı eklerken (supabase/tests/database/
-- payment_refunds_and_advances.test.sql'in mevcut şemaya karşı hâlâ
-- geçip geçmediği kontrol edilirken) ortaya çıkan gerçek bir bulgu —
-- testi "geç" olacak şekilde gevşetmek yerine kaynaktaki hatayı
-- düzeltiyoruz.

drop function if exists
public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid);

create or replace function public.record_payment_for_course(
  p_student_id uuid,
  p_course_id uuid,
  p_amount numeric,
  p_method text,
  p_note text,
  p_cash_account_id uuid default null
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
    v_organization_id, p_student_id, p_course_id, pg_catalog.now(), p_amount,
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
      p_amount, 1, pg_catalog.now(), v_payment_id,
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
      'receipt_number', v_receipt_number,
      'unallocated_remainder', v_remaining,
      'cash_movement_id', v_cash_movement_id
    )
  );

  return v_payment_id;
end;
$$;

revoke all on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid)
from public, anon;
grant execute on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid)
to authenticated;

notify pgrst, 'reload schema';
