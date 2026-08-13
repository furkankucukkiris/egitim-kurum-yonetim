"use client";

import { useEffect, useSyncExternalStore } from "react";

type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

const options: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Aydınlık",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-4 w-4"
      >
        <circle cx="12" cy="12" r="4" />
        <path
          strokeLinecap="round"
          d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        />
      </svg>
    ),
  },
  {
    value: "system",
    label: "Otomatik",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-4 w-4"
      >
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path strokeLinecap="round" d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Karanlık",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="h-4 w-4"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"
        />
      </svg>
    ),
  },
];

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getSnapshot(): ThemePreference {
  return (localStorage.getItem(STORAGE_KEY) as ThemePreference | null) ?? "system";
}

function getServerSnapshot(): ThemePreference {
  return "system";
}

function setPreference(next: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, next);
  window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
}

function applyTheme(preference: ThemePreference) {
  const isDark =
    preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", isDark);
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    applyTheme(preference);

    if (preference !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");

    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, [preference]);

  return (
    <div
      role="group"
      aria-label="Tema tercihi"
      className="inline-flex w-full max-w-xs items-center gap-1 rounded-full border border-border bg-surface-muted p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-label={option.label}
          aria-pressed={preference === option.value}
          title={option.label}
          onClick={() => setPreference(option.value)}
          className={`flex flex-1 items-center justify-center gap-2 rounded-full py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
            preference === option.value
              ? "bg-primary text-on-primary"
              : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          }`}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
