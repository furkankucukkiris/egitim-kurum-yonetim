export function SettingsAlert({ success, error }: { success?: string; error?: string }) {
  if (!success && !error) {
    return null;
  }

  return (
    <>
      {success && (
        <div className="mb-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          {success}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          {error}
        </div>
      )}
    </>
  );
}
