"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { Holiday } from "@/lib/holidays";

const weekdayLabels = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

const monthLabels = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function leadingBlankCount(year: number, month: number) {
  const jsWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (jsWeekday + 6) % 7;
}

export function Calendar({
  todayKey,
  holidays,
  canNavigateToSchedule = false,
}: {
  todayKey: string;
  holidays: Holiday[];
  canNavigateToSchedule?: boolean;
}) {
  const [year, setYear] = useState(Number(todayKey.slice(0, 4)));
  const [month, setMonth] = useState(Number(todayKey.slice(5, 7)));

  const monthPrefix = `${year}-${pad(month)}`;
  const holidaysThisMonth = holidays.filter((holiday) =>
    holiday.date.startsWith(monthPrefix),
  );
  const holidayByDate = new Map(
    holidaysThisMonth.map((holiday) => [holiday.date, holiday]),
  );

  const blanks = leadingBlankCount(year, month);
  const totalDays = daysInMonth(year, month);

  const cells: (number | null)[] = [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => index + 1),
  ];

  function goToPreviousMonth() {
    if (month === 1) {
      setYear((value) => value - 1);
      setMonth(12);
    } else {
      setMonth((value) => value - 1);
    }
  }

  function goToNextMonth() {
    if (month === 12) {
      setYear((value) => value + 1);
      setMonth(1);
    } else {
      setMonth((value) => value + 1);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink">Takvim</h3>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goToPreviousMonth}
            aria-label="Önceki ay"
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-fill hover:text-ink"
          >
            ‹
          </button>

          <p className="w-28 text-center text-sm font-medium text-ink">
            {monthLabels[month - 1]} {year}
          </p>

          <button
            type="button"
            onClick={goToNextMonth}
            aria-label="Sonraki ay"
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-fill hover:text-ink"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
        {weekdayLabels.map((label) => (
          <div key={label} className="py-1">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) {
            return <div key={`blank-${index}`} />;
          }

          const dateKey = `${year}-${pad(month)}-${pad(day)}`;
          const isToday = dateKey === todayKey;
          const holiday = holidayByDate.get(dateKey);

          const dayClasses = `relative grid aspect-square place-items-center rounded-lg text-sm transition ${
            isToday
              ? "bg-terra-700 font-bold text-white"
              : holiday
                ? "bg-rose-50 dark:bg-rose-500/10 font-medium text-rose-700 dark:text-rose-400"
                : "text-ink"
          } ${canNavigateToSchedule ? "hover:ring-2 hover:ring-terra-500/50" : ""}`;

          const content = (
            <>
              {day}
              {holiday && !isToday && (
                <span className="absolute bottom-1 h-1 w-1 rounded-full bg-rose-500" />
              )}
            </>
          );

          if (canNavigateToSchedule) {
            return (
              <Link
                key={dateKey}
                href={`/yoklama?date=${dateKey}`}
                title={holiday?.name}
                className={dayClasses}
              >
                {content}
              </Link>
            );
          }

          return (
            <div key={dateKey} title={holiday?.name} className={dayClasses}>
              {content}
            </div>
          );
        })}
      </div>

      {holidaysThisMonth.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-line pt-3">
          {holidaysThisMonth.map((holiday) => (
            <div key={holiday.date} className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold text-rose-700 dark:text-rose-400">
                {Number(holiday.date.slice(8, 10))} {monthLabels[month - 1]}
              </span>
              <span className="text-muted">
                {holiday.name}
                {holiday.halfDay ? " (yarım gün)" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
