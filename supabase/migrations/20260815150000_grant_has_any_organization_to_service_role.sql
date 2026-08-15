-- has_any_organization() yalnızca `authenticated`'a execute yetkisi
-- veriyordu (bkz. 20260808140000). Kodda hiçbir yer service_role ile
-- doğrudan RPC/tablo sorgusu yapmadığı için bu şimdiye kadar fark
-- edilmedi — service_role'ün taze bir yerel `db reset` sonrasında
-- fonksiyonlara/tablolara üstü kapalı (default privilege'lerden gelen)
-- erişimi olduğu varsayımı yanlış çıktı; hosted proje bunu yalnızca
-- tarihsel birikmiş yetkilerle çalıştırıyordu. service_role zaten
-- RLS'i bypass eden, tümüyle güvenilen bir backend rolü — bu grant bir
-- güvenlik zayıflatması değil, olması gereken erişimi açıkça belirtmek.
grant execute on function public.has_any_organization() to service_role;

notify pgrst, 'reload schema';
