# Finansal raporlar (Rapor A / Rapor B) — manuel doğrulama tablosu

Bu tablo [financial_reports.test.sql](financial_reports.test.sql) içindeki
pgTAP fixture'ının aynısını elle takip eder. Rapor aralığı **Temmuz-Eylül
2026** (`get_..._report_monthly('2026-07-01', '2026-09-01', ...)`).

## Girdi verisi

| Öğrenci | Durum | Ders | Tahakkuk | Ödeme | İade |
| --- | --- | --- | --- | --- | --- |
| Ali | active | Resim | Temmuz 1.000, **paid** | 1.000 TL, 5 Ağustos, cash | 200 TL, 10 Eylül |
| Ayşe | active | Piyano | Ağustos 1.000, **paid** | 1.000 TL, 10 Ağustos, bank_transfer | — |
| Mehmet | active | Resim | Temmuz 1.000, **overdue** | — | — |
| Elif | **left** | Resim | Ağustos 1.000, **partial** (300 tahsis) | 300 TL, 12 Ağustos, card | — |
| Kaan | active | Resim | Eylül 500, **open** | — | — |

Ayrıca Ağustos'ta Resim dersine bağlı, **ödenmiş** 400 TL'lik bir gider var
(`expenses.status = 'paid'`, `paid_at` = 20 Ağustos).

Tüm kayıtlar Ocak 2026'da başlamış (`starts_on`) — enrollment trigger'ının
otomatik açtığı Ocak tahakkuku rapor aralığının (Temmuz-Eylül) dışında
kaldığı için hesaplara hiç karışmıyor.

## Rapor A — Tahakkuk performansı (period_start esaslı)

### Aylık kırılım (filtresiz)

| Ay | Tahakkuk | Tahsilat | open | partial | overdue | paid |
| --- | --- | --- | --- | --- | --- | --- |
| Temmuz | 2.000 (Ali+Mehmet) | 1.000 (yalnızca Ali — ödeme tarihi Ağustos olsa da Temmuz'un tahakkuku sayılır) | 0 | 0 | 1.000 (Mehmet) | 1.000 (Ali) |
| Ağustos | 2.000 (Ayşe+Elif) | 1.300 (Ayşe 1.000 + Elif 300) | 0 | 700 (Elif) | 0 | 1.000 (Ayşe) |
| Eylül | 500 (Kaan) | 0 | 500 (Kaan) | 0 | 0 | 0 |

**Kritik nokta**: Eylül'deki 200 TL'lik iade bu tabloda hiç görünmez —
iade `accruals.allocated_amount`'ı geri almıyor (bilinen, ayrı görev
olarak flag'lenmiş kapsam dışı durum, bkz.
[dashboard_financial_summary.manual-verification.md](dashboard_financial_summary.manual-verification.md)).
Bu RPC'ler yalnızca `accruals` tablosunun canlı durumunu okur.

### `student_status = 'active'` filtresiyle

Elif (`left`) tamamen elenir → Ağustos: tahakkuk 1.000, tahsilat 1.000,
partial 0.

### Ders bazlı kırılım (filtresiz, Temmuz-Eylül toplamı)

| Ders | Tahakkuk | Tahsilat |
| --- | --- | --- |
| Resim | 3.500 (Ali 1.000 + Mehmet 1.000 + Elif 1.000 + Kaan 500) | 1.300 (Ali 1.000 + Elif 300) |
| Piyano | 1.000 (Ayşe) | 1.000 (Ayşe) |

Toplam: 4.500 tahakkuk, 2.300 tahsilat — aylık kırılımın toplamıyla
(2.000+2.000+500=4.500 / 1.000+1.300+0=2.300) **birebir eşleşir**.

`student_status = 'active'` ile Resim: 2.500 tahakkuk (Elif'in 1.000'i
düşer).

## Rapor B — Nakit akışı (received_at / iade created_at / gider paid_at esaslı)

### Aylık kırılım (filtresiz)

| Ay | Nakit girişi | İade | Gider | Net |
| --- | --- | --- | --- | --- |
| Temmuz | 0 | 0 | 0 | 0 |
| Ağustos | 2.300 (Ali 1.000 + Ayşe 1.000 + Elif 300) | 0 | 400 | 1.900 |
| Eylül | 0 | 200 (Ali'nin ödemesinden) | 0 | -200 |

**Kritik nokta**: Ali'nin 1.000 TL'lik ödemesi Temmuz'un borcuna aitken
Ağustos'ta alınmış — nakit raporunda **Ağustos**'un girişi olarak sayılır,
Temmuz'da hiç görünmez. Aynı ödemenin Eylül'de iade edilen 200 TL'si de
**Eylül**'ün nakit çıkışı olarak sayılır (iade hangi ayın borcuna ait
olduğuna değil, iadenin gerçekten yapıldığı aya bakılır).

### Filtreler (Ağustos üzerinden)

| Filtre | Ağustos nakit girişi |
| --- | --- |
| (yok) | 2.300 |
| `student_status = active` | 2.000 (Elif elenir) |
| `course = Resim` | 1.300 (Ali 1.000 + Elif 300, Ayşe/Piyano hariç) |
| `method = cash` | 1.000 (yalnızca Ali) |

### Yöntem bazlı kırılım (filtresiz, Temmuz-Eylül toplamı)

| Yöntem | Nakit girişi | İade | Net | İşlem sayısı |
| --- | --- | --- | --- | --- |
| cash | 1.000 (Ali) | 200 (Ali'nin iadesi) | 800 | 1 |
| bank_transfer | 1.000 (Ayşe) | 0 | 1.000 | 1 |
| card | 300 (Elif) | 0 | 300 | 1 |

Toplam nakit girişi: 2.300 — aylık kırılımın toplamıyla (0+2.300+0=2.300)
**birebir eşleşir**. `student_status = active` filtresiyle `card` satırı
tamamen kaybolur (Elif'in tek ödemesi elenir, ne giriş ne iade kalır).

## Beklenen RPC çıktıları (özet)

| RPC / satır | Alan | Beklenen |
| --- | --- | --- |
| `get_accrual_report_monthly` Temmuz | accrued / collected / overdue_amount | 2.000 / 1.000 / 1.000 |
| `get_accrual_report_monthly` Ağustos | accrued / partial_amount | 2.000 / 700 |
| `get_accrual_report_monthly` Eylül | open_amount | 500 |
| `get_accrual_report_monthly` Ağustos (`active`) | accrued / partial_amount | 1.000 / 0 |
| `get_accrual_report_by_course` Resim | accrued / collected | 3.500 / 1.300 |
| `get_accrual_report_by_course` Piyano | accrued | 1.000 |
| `get_accrual_report_by_course` Resim (`active`) | accrued | 2.500 |
| `get_cash_flow_report_monthly` Ağustos | cash_in / expenses_paid / net_cash | 2.300 / 400 / 1.900 |
| `get_cash_flow_report_monthly` Eylül | refunds / net_cash | 200 / -200 |
| `get_cash_flow_report_monthly` Ağustos (`active`) | cash_in | 2.000 |
| `get_cash_flow_report_monthly` Ağustos (`course=Resim`) | cash_in | 1.300 |
| `get_cash_flow_report_monthly` Ağustos (`method=cash`) | cash_in | 1.000 |
| `get_cash_flow_report_by_method` cash | net_cash | 800 |
| `get_cash_flow_report_by_method` card | cash_in | 300 |
| `get_cash_flow_report_by_method` bank_transfer | payment_count | 1 |
