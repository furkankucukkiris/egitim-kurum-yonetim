// Ders etiketleri; her derse oluşturulma sırasına göre sabit bir renk
// düşer, böylece yeni ders eklenince mevcut derslerin rengi kaymaz.
export const coursePinClasses = [
  "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200",
  "bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-200",
  "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-200",
  "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-200",
  "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200",
];

// courses tablosundan created_at (ve eşitlikte id) sırasıyla gelen ders
// kimliklerinden ders → etiket rengi eşlemesi.
export function buildCoursePinMap(courseIdsInCreationOrder: string[]) {
  return new Map(
    courseIdsInCreationOrder.map((id, index) => [
      id,
      coursePinClasses[index % coursePinClasses.length],
    ]),
  );
}
