import { describe, expect, it } from "vitest";
import { isIsoDate, isMonthValue, parseMoney } from "./format";

describe("parseMoney", () => {
  it("virgülü ondalık ayracı olarak kabul eder", () => {
    expect(parseMoney("1250,50")).toBe(1250.5);
  });

  it("noktayı ondalık ayracı olarak kabul eder", () => {
    expect(parseMoney("1250.5")).toBe(1250.5);
  });

  it("boşlukları (binlik ayracı yazımını) temizler", () => {
    expect(parseMoney("1 250,50")).toBe(1250.5);
  });

  it("tam sayıyı kabul eder", () => {
    expect(parseMoney("1000")).toBe(1000);
  });

  it("ikiden fazla ondalık hane olduğunda null döner", () => {
    expect(parseMoney("10,999")).toBeNull();
  });

  it("harf içeren girdide null döner", () => {
    expect(parseMoney("abc")).toBeNull();
  });

  it("boş girdide null döner", () => {
    expect(parseMoney("")).toBeNull();
  });

  it("negatif sayıyı kabul etmez (regex + eksi işareti girdiyi geçersiz kılar)", () => {
    expect(parseMoney("-50")).toBeNull();
  });
});

describe("isIsoDate", () => {
  it("geçerli bir ISO tarihi kabul eder", () => {
    expect(isIsoDate("2026-08-14")).toBe(true);
  });

  it("artık yılda 29 Şubat'ı kabul eder", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("artık olmayan yılda 29 Şubat'ı reddeder (JS Date taşırır, karşılaştırma yakalar)", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
  });

  it("geçersiz ay değerini reddeder", () => {
    expect(isIsoDate("2026-13-01")).toBe(false);
  });

  it("yanlış formatı (gün/ay/yıl) reddeder", () => {
    expect(isIsoDate("14-08-2026")).toBe(false);
  });

  it("boş metni reddeder", () => {
    expect(isIsoDate("")).toBe(false);
  });
});

describe("isMonthValue", () => {
  it("geçerli bir YYYY-MM değerini kabul eder", () => {
    expect(isMonthValue("2026-08")).toBe(true);
  });

  it("ay 00 olduğunda reddeder", () => {
    expect(isMonthValue("2026-00")).toBe(false);
  });

  it("ay 13 olduğunda reddeder", () => {
    expect(isMonthValue("2026-13")).toBe(false);
  });

  it("gün eklenmiş bir değeri reddeder", () => {
    expect(isMonthValue("2026-08-14")).toBe(false);
  });
});
