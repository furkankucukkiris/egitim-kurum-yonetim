-- record_delivery_attempt() içindeki CASE ifadesi 'sent'/'failed'
-- dallarını (cast olmadan) text'e birleştiriyordu — outbound_messages.status
-- sütunu public.outbound_message_status enum'ı olduğu için doğrudan atama
-- "column is of type outbound_message_status but expression is of type text"
-- hatasıyla başarısız oluyordu (record_payment_for_course()'daki
-- accrual_status CASE'lerinde her dal ayrı ayrı cast edilmişti, burada
-- unutulmuş). Canlı smoke test sırasında (dev projesinde) yakalandı.

create or replace function public.record_delivery_attempt(
  p_message_id uuid,
  p_status public.delivery_attempt_status,
  p_provider text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_message_status public.outbound_message_status;
  v_attempt_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Gönderim denemesi kaydetme yetkiniz bulunmuyor.';
  end if;

  select status into v_message_status
  from public.outbound_messages
  where id = p_message_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Mesaj kaydı bulunamadı.';
  end if;

  if v_message_status <> 'sending' then
    raise exception 'Yalnızca gönderim aşamasındaki mesajlar için deneme kaydedilebilir.';
  end if;

  insert into public.delivery_attempts (
    message_id, organization_id, status, provider, provider_message_id,
    error_code, error_message, attempted_by
  )
  values (
    p_message_id, v_organization_id, p_status, p_provider, p_provider_message_id,
    p_error_code, p_error_message, v_user_id
  )
  returning id into v_attempt_id;

  update public.outbound_messages
  set status = case
        when p_status = 'success' then 'sent'::public.outbound_message_status
        else 'failed'::public.outbound_message_status
      end,
      sent_at = case when p_status = 'success' then pg_catalog.now() else sent_at end,
      updated_at = pg_catalog.now()
  where id = p_message_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'outbound_messages', p_message_id::text,
    case when p_status = 'success' then 'send' else 'send_failed' end,
    pg_catalog.jsonb_build_object('status', 'sending'),
    pg_catalog.jsonb_build_object(
      'status', case when p_status = 'success' then 'sent' else 'failed' end,
      'provider', p_provider,
      'error_code', p_error_code
    )
  );

  return v_attempt_id;
end;
$$;

notify pgrst, 'reload schema';
