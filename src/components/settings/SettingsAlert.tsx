export function SettingsAlert({ success, error }: { success?: string; error?: string }) {
  if (!success && !error) {
    return null;
  }

  return (
    <>
      {success && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {success}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {error}
        </div>
      )}
    </>
  );
}
