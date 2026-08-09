# Dashboard finans özeti — manuel doğrulama tablosu

Bu tablo, [dashboard_financial_summary.test.sql](dashboard_financial_summary.test.sql)
içindeki pgTAP fixture'ının **aynısını** elle takip edip, RPC'nin
döndürdüğü her rakamı satır satır doğrulamak için hazırlandı. "Bu ay"
**Nisan 2026**, "önceki dönem" **Mart 2026**'dır — testte
`get_dashboard_financial_summary('2026-04-01')` çağrılır.

## Girdi verisi

| Öğrenci | Mart 2026 tahakkuku (1.000 TL) | Nisan 2026 tahakkuku (1.000 TL) | Ödeme (Nisan içinde) |
| --- | --- | --- | --- |
| 1 (Ali) | **açık → ödendi** (Nisan'da 1.000 TL ödeme, Mart'a tahsis) | açık (dokunulmadı) | 1.000 TL, 5 Nisan, iade yok |
| 2 (Ayşe) | açık (dokunulmadı) | **açık → ödendi** (Nisan'da 1.000 TL, kendi ayına tahsis) | 1.000 TL, 10 Nisan, iade yok |
| 3 (Mehmet) | **açık → ödendi** | **açık → ödendi** | 2.500 TL, 15 Nisan — 1.000 Mart'a, 1.000 Nisan'a, **500 TL tahsis edilmeden kalır (avans)** |
| 4 | açık (dokunulmadı) | ödendi ama **ödeme iade edildi** (`is_refunded = true`) | 1.000 TL, 8 Nisan, **iade edildi** |
| 5–20 (16 kişi) | açık | açık | yok |
| "İptal Testi" | — (Mart kaydı yok) | tahakkuk var ama **status = 'cancelled'** | yok |
| "Ayrılan Öğrenci" | — | — | — (`students.status = 'left'`, aktif değil) |

Tüm tahakkuklar aynı dersin (Resim) aynı grubunda; toplam **20 farklı
öğrencinin** aynı derste borcu var — bu, eski "course_id +
period_start" anahtarlı sayımın 20 öğrenciyi tek satıra
düşürdüğü hatayı doğrudan test eder.

## Elle hesap

**Devreden borç (Mart, `period_start < 2026-04-01`, yalnızca açık kalanlar):**
Öğrenci 2, 4 ve 5–20 (16 kişi) = **18 öğrenci** × 1.000 TL = **18.000 TL**
(1 ve 3 Mart'ı kapattığı için sayılmaz; "İptal Testi" ve "Ayrılan
Öğrenci"nin Mart kaydı yok.)

**Bu ay tahakkuk eden (Nisan, iptal hariç):**
20 öğrenci × 1.000 TL = **20.000 TL** ("İptal Testi"nin 1.000 TL'lik
tahakkuku `cancelled` olduğu için dahil değil.)

**Bu ayın tahakkuklarından tahsil edilen (yalnızca Nisan'a tahsis edilen tutar):**
Öğrenci 2 (1.000, kendi Nisan'ına) + Öğrenci 3 (1.000, Nisan payı) +
Öğrenci 4 (1.000, Nisan payı — iade accrual'ı geri almadığı için hâlâ
"paid" görünüyor, bkz. aşağıdaki not) = **3.000 TL**.
Öğrenci 1'in Mart'a giden 1.000 TL'si burada **sayılmaz**.

**Bu ay kasaya giren nakit (received_at Nisan içinde, iade hariç):**
Öğrenci 1 (1.000) + Öğrenci 2 (1.000) + Öğrenci 3 (2.500) = **4.500 TL**.
Öğrenci 4'ün 1.000 TL'si iade edildiği için **sayılmaz**.

**Toplam açık alacak (Mart + Nisan, açık kalanlar):**
Devreden (18.000) + Nisan'ın kendi açığı. Nisan'da yalnızca Öğrenci 1
(1.000) ve 5–20 (16 × 1.000 = 16.000) hâlâ açık = 17.000 TL.
Toplam = 18.000 + 17.000 = **35.000 TL**, **35 bekleyen dönem**
(18 Mart + 17 Nisan).

**Öğrenci avans/bakiyesi:**
Yalnızca Öğrenci 3'ün ödemesinde tahsis edilmeyen kalan var:
2.500 − (1.000 + 1.000) = **500 TL**. Diğer tüm ödemeler tam tahsis
edildi; Öğrenci 4'ün ödemesi iade olduğu için hiç sayılmıyor.

**Aktif öğrenci sayısı:** 20 + "İptal Testi" = 21 (`status = 'active'`).
"Ayrılan Öğrenci" (`status = 'left'`) hariç.

**Bugünkü ders oturumları:** 2 oturum eklendi, biri iptal edildi →
aktif = **1**, toplam = **2**.

## Beklenen RPC çıktısı

| Alan | Beklenen değer |
| --- | --- |
| `active_student_count` | 21 |
| `monthly_accrued` | 20.000 |
| `monthly_collected` | 3.000 |
| `monthly_cash_received` | 4.500 |
| `prior_period_carryover` | 18.000 |
| `prior_period_carryover_count` | 18 |
| `total_open_receivable` | 35.000 |
| `total_open_receivable_count` | 35 |
| `student_advance_balance` | 500 |
| `today_active_session_count` | 1 |
| `today_total_session_count` | 2 |

`get_dashboard_course_performance('2026-04-01')` tek satır döner
(Resim): `month_net = 20.000`, `month_collected = 3.000`.

## Bilinen, bu görevin kapsamı dışında bırakılan durum

Öğrenci 4'ün ödemesi iade edilmesine rağmen `accruals.allocated_amount`
geri alınmıyor (bu depoda ödeme iadesini tahakkuka yansıtan bir RPC
hiç yok — `payments.is_refunded` alanı var ama onu `true` yapan hiçbir
kod yok). Bu yüzden `monthly_collected` hâlâ bu 1.000 TL'yi içeriyor;
yalnızca **nakit** tarafındaki metrikler (`monthly_cash_received`,
`student_advance_balance`) iade filtresini doğru uyguluyor — bunlar
doğrudan `payments`/`payment_allocations`'tan hesaplanıyor, tahakkuk
satırının durumuna bağlı değil. Gerçek bir "ödeme iadesi" özelliği
(tahakkuku da geri açan) ayrı bir görev olarak flag'lendi.
