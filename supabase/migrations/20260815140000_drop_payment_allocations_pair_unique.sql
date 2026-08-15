-- payment_allocations üzerindeki eski unique (payment_id, accrual_id)
-- kısıtı (20260725103000, ilk şemadan), record_payment_for_course'un
-- TEK bir dağıtım çağrısında aynı çifti iki kez eklemesini önlemek
-- için konmuştu. allocate_student_advance() (20260811130000) ise
-- meşru bir senaryoyu kırıyor: aynı ödemenin dağıtılmamış (avans)
-- kısmı, birden fazla admin işlemiyle AYNI tahakkuka kademeli olarak
-- uygulanabilmeli (ör. önce 600 TL, sonra kalan avansla sınırlı 400 TL
-- daha) — her çağrı payment_allocations'a append-only yeni bir satır
-- ekliyor (20260811130000'in kendi tasarım ilkesi: bu tablo asla
-- mutasyona uğratılmaz, yalnızca yeni satır eklenir), bu da ikinci
-- çağrıda bu kısıtı ihlal ediyordu.
--
-- Toplam tahsis tutarı her yerde sum(amount) ile hesaplanıyor
-- (allocate_student_advance'in kendi v_allocated_total'ı dahil), bu
-- yüzden aynı çift için birden fazla satır olması hiçbir toplamı
-- bozmaz — yalnızca kısıtın kendisi gereksiz derecede kısıtlayıcıydı.

alter table public.payment_allocations
drop constraint if exists payment_allocations_payment_id_accrual_id_key;
