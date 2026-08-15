-- allocate_student_advance() regresyonu: fonksiyonun kendi tasarım
-- özeti (20260811130000, "hedef tahakkukun bekleyeninde ve ödemenin
-- avansında kapanır (aşarsa otomatik sınırlanır)") istenen tutarın
-- kullanılabilir avansı VEYA tahakkukun bekleyen bakiyesini aşması
-- durumunda uygulanan tutarın SESSİZCE bu sınıra kısıtlanmasını
-- öngörüyor. Gövde yalnızca bekleyen bakiye tarafını (v_pending)
-- kısıtlıyordu; kullanılabilir avans tarafında ise (v_available)
-- istek bu tutarı aştığında sınırlamak yerine tamamen reddediyordu
-- (raise exception). Bu, "avansın bir kısmı kullanılabilir kalan
-- avansla sınırlanarak uygulanır" senaryosunu (örn. 400 TL avans
-- kalmışken 1000 TL istenmesi) hatalı biçimde başarısız kılıyordu.
--
-- Düzeltme: yalnızca kullanılabilir avans GERÇEKTEN tükenmişse
-- (v_available <= 0) hata fırlatılır; aksi halde uygulanan tutar
-- min(istenen, kullanılabilir avans, bekleyen bakiye) olarak
-- sınırlanır — fonksiyonun geri kalanı (yetki kontrolü, aynı öğrenci
-- kısıtı, audit_logs) değişmedi.

create or replace function public.allocate_student_advance(
  p_payment_id uuid,
  p_accrual_id uuid,
  p_amount numeric
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_payment record;
  v_accrual record;
  v_allocated_total numeric(12,2);
  v_refunded_total numeric(12,2);
  v_available numeric(12,2);
  v_pending numeric(12,2);
  v_allocate numeric(12,2);
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Avans dağıtma yetkiniz bulunmuyor.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  select p.id, p.amount, p.student_id
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.organization_id = v_organization_id
  for update;

  if v_payment.id is null then
    raise exception 'Ödeme kaydı bulunamadı.';
  end if;

  select a.id, a.net_amount, a.allocated_amount, a.student_id
  into v_accrual
  from public.accruals a
  where a.id = p_accrual_id
    and a.organization_id = v_organization_id
  for update;

  if v_accrual.id is null then
    raise exception 'Tahakkuk kaydı bulunamadı.';
  end if;

  if v_accrual.student_id <> v_payment.student_id then
    raise exception 'Avans yalnızca aynı öğrencinin bir tahakkukuna uygulanabilir.';
  end if;

  select coalesce(sum(amount), 0) into v_allocated_total
  from public.payment_allocations where payment_id = p_payment_id;

  select coalesce(sum(amount), 0) into v_refunded_total
  from public.payment_refunds where payment_id = p_payment_id;

  v_available := v_payment.amount - v_allocated_total - v_refunded_total;

  if v_available <= 0.01 then
    raise exception 'Bu ödemenin dağıtılmamış (avans) tutarı yetersiz.';
  end if;

  v_pending := v_accrual.net_amount - v_accrual.allocated_amount;

  if v_pending <= 0.01 then
    raise exception 'Seçilen tahakkukta bekleyen bakiye yok.';
  end if;

  v_allocate := least(p_amount, v_available, v_pending);

  insert into public.payment_allocations (
    organization_id, payment_id, accrual_id, amount
  )
  values (
    v_organization_id, p_payment_id, p_accrual_id, v_allocate
  );

  update public.accruals
  set allocated_amount = allocated_amount + v_allocate,
      status = case
        when allocated_amount + v_allocate >= net_amount
          then 'paid'::public.accrual_status
        else 'partial'::public.accrual_status
      end
  where id = p_accrual_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'payment_allocations', p_payment_id::text,
    'allocate_advance', null,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'accrual_id', p_accrual_id,
      'requested_amount', p_amount,
      'applied_amount', v_allocate
    )
  );

  return v_allocate;
end;
$$;

notify pgrst, 'reload schema';
