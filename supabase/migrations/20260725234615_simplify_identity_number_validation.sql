-- T.C. kimlik numarası alanlarında yalnızca temel biçim kontrolü yapar.
-- Bu kontrol resmî kimlik doğrulaması değildir.
-- 11 rakam olmasını ve ilk rakamın sıfır olmamasını denetler.

create or replace function public.is_valid_tckn(
  p_value text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.btrim(p_value) ~ '^[1-9][0-9]{10}$';
$$;

comment on function public.is_valid_tckn(text)
is 'Yalnızca 11 haneli T.C. kimlik numarası biçimini kontrol eder; kimlik doğrulaması yapmaz.';

revoke all
on function public.is_valid_tckn(text)
from public;

notify pgrst, 'reload schema';