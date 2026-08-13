export type Holiday = {
  date: string;
  name: string;
  halfDay?: boolean;
};

const FIXED_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "Yılbaşı" },
  { month: 4, day: 23, name: "Ulusal Egemenlik ve Çocuk Bayramı" },
  { month: 5, day: 1, name: "Emek ve Dayanışma Günü" },
  { month: 5, day: 19, name: "Atatürk'ü Anma, Gençlik ve Spor Bayramı" },
  { month: 7, day: 15, name: "Demokrasi ve Millî Birlik Günü" },
  { month: 8, day: 30, name: "Zafer Bayramı" },
  { month: 10, day: 28, name: "Cumhuriyet Bayramı Arifesi" },
  { month: 10, day: 29, name: "Cumhuriyet Bayramı" },
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function addDaysISO(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function hijriPartsFor(date: Date) {
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);

  return { month: get("month"), day: get("day") };
}

/**
 * Diyanet'in kullandığı hesaplı (astronomik) Hicri takvime en yakın
 * eşleniği veren ICU "islamic-umalqura" takvimiyle, verilen Miladi yıl
 * içinde belirtilen Hicri ay/güne denk gelen tarihi arar. Diyanet'in
 * resmi ilanı çok nadir durumlarda 1 gün farklı olabilir.
 */
function findGregorianDateForHijri(
  targetMonth: number,
  targetDay: number,
  gregorianYear: number,
): string | null {
  const cursor = new Date(Date.UTC(gregorianYear, 0, 1));
  const end = new Date(Date.UTC(gregorianYear, 11, 31));

  while (cursor <= end) {
    const hijri = hijriPartsFor(cursor);

    if (hijri.month === targetMonth && hijri.day === targetDay) {
      return cursor.toISOString().slice(0, 10);
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return null;
}

function getReligiousHolidaysForYear(year: number): Holiday[] {
  const holidays: Holiday[] = [];

  // Şevval ayının 1. günü = Ramazan Bayramı 1. gün.
  const ramazanFirstDay = findGregorianDateForHijri(10, 1, year);

  if (ramazanFirstDay) {
    holidays.push({
      date: addDaysISO(ramazanFirstDay, -1),
      name: "Ramazan Bayramı Arifesi",
      halfDay: true,
    });

    for (let day = 0; day < 3; day += 1) {
      holidays.push({
        date: addDaysISO(ramazanFirstDay, day),
        name: `Ramazan Bayramı (${day + 1}. gün)`,
      });
    }
  }

  // Zilhicce ayının 10. günü = Kurban Bayramı 1. gün.
  const kurbanFirstDay = findGregorianDateForHijri(12, 10, year);

  if (kurbanFirstDay) {
    holidays.push({
      date: addDaysISO(kurbanFirstDay, -1),
      name: "Kurban Bayramı Arifesi",
      halfDay: true,
    });

    for (let day = 0; day < 4; day += 1) {
      holidays.push({
        date: addDaysISO(kurbanFirstDay, day),
        name: `Kurban Bayramı (${day + 1}. gün)`,
      });
    }
  }

  return holidays;
}

export function getHolidaysForYear(year: number): Holiday[] {
  const fixed = FIXED_HOLIDAYS.map((item) => ({
    date: `${year}-${pad(item.month)}-${pad(item.day)}`,
    name: item.name,
    halfDay: item.name.includes("Arifesi") ? true : undefined,
  }));

  // Sabit ve dini bayram tarihleri bazı yıllarda çakışabilir (ör. 2027'de
  // Kurban Bayramı 2. günü 19 Mayıs'a denk geliyor) — aynı tarihe düşen
  // kayıtlar tek bir güne birleştirilir, aksi halde takvimde aynı anahtarla
  // iki ayrı satır oluşur.
  const byDate = new Map<string, Holiday>();

  for (const holiday of [...fixed, ...getReligiousHolidaysForYear(year)]) {
    const existing = byDate.get(holiday.date);

    byDate.set(holiday.date, existing
      ? {
          date: holiday.date,
          name: `${existing.name} / ${holiday.name}`,
          halfDay: Boolean(existing.halfDay) && Boolean(holiday.halfDay),
        }
      : holiday);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function getHolidaysForYearRange(startYear: number, endYear: number): Holiday[] {
  const holidays: Holiday[] = [];

  for (let year = startYear; year <= endYear; year += 1) {
    holidays.push(...getHolidaysForYear(year));
  }

  return holidays;
}
