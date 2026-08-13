// Para/tarih girişi doğrulama ve ayrıştırma — daha önce ~10 farklı
// actions.ts dosyasında birebir aynı şekilde kopyalanmıştı. Buraya
// taşınıp test edilebilir hale getirildi (bkz. format.test.ts).
// Mevcut kopyaların TÜMÜNÜ bu tek oturumda değiştirmek riskli bir
// kapsam genişlemesi olurdu — yalnızca indirim/tarih mantığını da
// içeren enrollment-actions.ts buraya taşındı, geri kalanı ayrı bir
// takip görevi olarak bırakıldı.

export function parseMoney(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(",", ".");

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount) ? amount : null;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isMonthValue(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
