import { describe, expect, it } from "vitest";
import { paymentsExportRowsToCsv, type PaymentsExportRow } from "./export";

const sampleRow: PaymentsExportRow = {
  studentName: "Ayşe Yılmaz",
  courseName: "Piyano",
  periodStart: "2026-08-01",
  status: "Bekliyor",
  netAmount: 1500,
  allocatedAmount: 500,
  pendingAmount: 1000,
  dueDate: "2026-08-05",
};

describe("paymentsExportRowsToCsv", () => {
  it("UTF-8 BOM ile başlar (Excel'in Türkçe karakterleri doğru göstermesi için)", () => {
    const csv = paymentsExportRowsToCsv([sampleRow]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("başlık satırını noktalı virgülle ayırır", () => {
    const csv = paymentsExportRowsToCsv([]);
    const firstLine = csv.slice(1).split("\r\n")[0];

    expect(firstLine).toBe(
      "Öğrenci;Ders;Dönem;Durum;Tahakkuk (TL);Tahsil Edilen (TL);Bekleyen (TL);Vade Tarihi",
    );
  });

  it("bir satırı doğru sırada ve ayraçla yazar", () => {
    const csv = paymentsExportRowsToCsv([sampleRow]);
    const lines = csv.slice(1).split("\r\n");

    expect(lines[1]).toBe("Ayşe Yılmaz;Piyano;2026-08-01;Bekliyor;1500;500;1000;2026-08-05");
  });

  it("noktalı virgül veya tırnak içeren alanı tırnak içine alıp kaçış yapar", () => {
    const csv = paymentsExportRowsToCsv([{ ...sampleRow, studentName: 'Ali; "Kısa" Veli' }]);
    const lines = csv.slice(1).split("\r\n");

    expect(lines[1].startsWith('"Ali; ""Kısa"" Veli";')).toBe(true);
  });

  it("boş liste için sadece başlık satırını üretir", () => {
    const csv = paymentsExportRowsToCsv([]);
    const lines = csv.slice(1).split("\r\n");

    expect(lines).toHaveLength(1);
  });
});
