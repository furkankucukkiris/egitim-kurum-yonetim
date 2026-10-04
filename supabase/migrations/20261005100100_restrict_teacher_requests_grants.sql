-- 20261005100000'de varsayılan şema yetkileri (anon/authenticated için
-- tüm tablo yetkileri) kaldırılmamıştı. RLS veriyi zaten koruyordu; yine
-- de diğer RPC-yazımlı tablolarla aynı şekilde yazma yalnızca security
-- definer RPC'ler üzerinden, okuma yalnızca authenticated için açık kalır.

revoke all on public.teacher_requests from anon, authenticated;
revoke all on public.teacher_request_replies from anon, authenticated;

grant select on public.teacher_requests to authenticated;
grant select on public.teacher_request_replies to authenticated;

notify pgrst, 'reload schema';
