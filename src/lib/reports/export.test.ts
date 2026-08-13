import { describe, expect, it } from "vitest";
import { accrualReportToCsv, cashFlowReportToCsv } from "./export";

// Ay etiketinin tam metnini varsayımla hardcode etmek yerine aynı
// Intl çağrısıyla üretiyoruz — testin amacı ay adının yazımı değil,
// CSV satırlarının doğru sırada/toplamda üretilmesi (tarihe bağlı
// rastgelelik yok, sabit bir girdi tarihi kullanılıyor).
function monthLabel(monthStart: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthStart}T00:00:00.000Z`));
}

describe("accrualReportToCsv", () => {
  const data = {
    monthly: [
      {
        month_start: "2026-08-01",
        accrued: "5000",
        collected: "3000",
        open_amount: "1000",
        partial_amount: "500",
        overdue_amount: "500",
        paid_amount: "3000",
        open_count: 2,
        partial_count: 1,
        overdue_count: 1,
        paid_count: 6,
      },
    ],
    byCourse: [
      {
        course_id: "c1",
        course_name: "Piyano",
        accrued: "2000",
        collected: "1500",
        open_count: 1,
        partial_count: 0,
        overdue_count: 0,
        paid_count: 3,
      },
    ],
  };

  it("UTF-8 BOM ile başlar", () => {
    expect(accrualReportToCsv(data).charCodeAt(0)).toBe(0xfeff);
  });

  it("aylık kırılım satırında sayısal alanları string'den number'a çevirip yazar", () => {
    const csv = accrualReportToCsv(data);
    const lines = csv.slice(1).split("\r\n");

    expect(lines[2]).toBe(`${monthLabel("2026-08-01")};5000;3000;1000;500;500;3000;2;1;1;6`);
  });

  it("ders bazlı bölüm ayrı bir başlıkla ve doğru sırayla yazılır", () => {
    const csv = accrualReportToCsv(data);
    const lines = csv.slice(1).split("\r\n");

    expect(lines).toContain("DERS BAZLI TAHAKKUK VE TAHSİLAT");
    expect(lines[lines.length - 1]).toBe("Piyano;2000;1500;1;0;0;3");
  });
});

describe("cashFlowReportToCsv", () => {
  const data = {
    monthly: [
      {
        month_start: "2026-08-01",
        cash_in: "4000",
        refunds: "200",
        expenses_paid: "1000",
        net_cash: "2800",
      },
    ],
    byMethod: [
      {
        method: "cash",
        cash_in: "3000",
        refunds: "100",
        net_cash: "2900",
        payment_count: 12,
      },
      {
        method: "bank_transfer",
        cash_in: "1000",
        refunds: "100",
        net_cash: "900",
        payment_count: 3,
      },
    ],
  };

  it("yöntem kodunu Türkçe etikete çevirir", () => {
    const csv = cashFlowReportToCsv(data);
    const lines = csv.slice(1).split("\r\n");

    expect(lines.some((line) => line.startsWith("Nakit;"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Havale;"))).toBe(true);
  });

  it("bilinmeyen yöntem kodunu olduğu gibi bırakır", () => {
    const csv = cashFlowReportToCsv({
      ...data,
      byMethod: [
        {
          method: "crypto",
          cash_in: "10",
          refunds: "0",
          net_cash: "10",
          payment_count: 1,
        },
      ],
    });

    expect(csv.includes("crypto;10;0;10;1")).toBe(true);
  });
});
