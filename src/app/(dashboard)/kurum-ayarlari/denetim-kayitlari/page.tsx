import { Card } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  actionLabel,
  fieldLabel,
  formatAuditValue,
  isSensitiveAuditKey,
  tableLabels,
} from "@/lib/audit/labels";

const PAGE_SIZE = 25;

type AuditRow = {
  id: number;
  actor_profile_id: string | null;
  table_name: string;
  record_id: string | null;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  profiles: { full_name: string } | null;
};

type Actor = {
  id: string;
  full_name: string;
};

type PageProps = {
  searchParams: Promise<{
    table?: string;
    actor?: string;
    start?: string;
    end?: string;
    search?: string;
    page?: string;
  }>;
};

export default async function AuditLogPage({ searchParams }: PageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const tableFilter = params.table ?? "";
  const actorFilter = params.actor ?? "";
  const startFilter = params.start ?? "";
  const endFilter = params.end ?? "";
  const search = (params.search ?? "").trim();
  const page = Math.max(1, Number(params.page ?? "1") || 1);

  const supabase = await createClient();

  let query = supabase
    .from("audit_logs")
    .select(
      "id, actor_profile_id, table_name, record_id, action, old_data, new_data, created_at, profiles(full_name)",
      { count: "exact" },
    )
    .eq("organization_id", profile.organizationId)
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (tableFilter) query = query.eq("table_name", tableFilter);
  if (actorFilter) query = query.eq("actor_profile_id", actorFilter);
  if (startFilter) query = query.gte("created_at", `${startFilter}T00:00:00`);
  if (endFilter) query = query.lte("created_at", `${endFilter}T23:59:59`);
  if (search) query = query.or(`action.ilike.%${search}%,record_id.ilike.%${search}%`);

  const [{ data: rows, error, count }, { data: actors, error: actorsError }] = await Promise.all([
    query,
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("organization_id", profile.organizationId)
      .order("full_name"),
  ]);

  if (error) console.error("Denetim kayıtları alınamadı:", error);
  if (actorsError) console.error("Kullanıcı listesi alınamadı:", actorsError);

  const auditRows = (rows ?? []) as unknown as AuditRow[];
  const actorList = (actors ?? []) as Actor[];
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const distinctTables = [...new Set(auditRows.map((row) => row.table_name))];
  const tableOptions = Object.keys(tableLabels).sort((a, b) =>
    tableLabels[a].localeCompare(tableLabels[b], "tr"),
  );

  const buildQuery = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({
      table: tableFilter,
      actor: actorFilter,
      start: startFilter,
      end: endFilter,
      search,
      page: String(page),
      ...overrides,
    });

    for (const [key, value] of [...next.entries()]) {
      if (!value) next.delete(key);
    }

    return `/kurum-ayarlari/denetim-kayitlari?${next.toString()}`;
  };

  return (
    <>
      <Card className="mb-6 p-4">
        <form method="get" className="grid gap-3 sm:grid-cols-5">
          <label className="text-xs font-medium text-text-secondary">
            Modül / tablo
            <select
              name="table"
              defaultValue={tableFilter}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            >
              <option value="">Tümü</option>
              {tableOptions.map((name) => (
                <option key={name} value={name}>
                  {tableLabels[name]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-text-secondary">
            Kullanıcı
            <select
              name="actor"
              defaultValue={actorFilter}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            >
              <option value="">Tümü</option>
              {actorList.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.full_name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-text-secondary">
            Başlangıç
            <input
              name="start"
              type="date"
              defaultValue={startFilter}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <label className="text-xs font-medium text-text-secondary">
            Bitiş
            <input
              name="end"
              type="date"
              defaultValue={endFilter}
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <label className="text-xs font-medium text-text-secondary">
            Ara (işlem / kayıt no)
            <input
              name="search"
              type="text"
              defaultValue={search}
              placeholder="ör. cancel_session"
              className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <div className="sm:col-span-5">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
            >
              Filtrele
            </button>
          </div>
        </form>
      </Card>

      <Card className="p-4">
        <p className="mb-4 text-xs text-text-secondary">
          {totalCount} kayıttan {auditRows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–
          {Math.min(page * PAGE_SIZE, totalCount)} arası gösteriliyor.
          {distinctTables.length > 0 &&
            ` Bu sayfadaki tablolar: ${distinctTables.map((t) => tableLabels[t] ?? t).join(", ")}.`}
        </p>

        {auditRows.length === 0 ? (
          <p className="text-sm text-text-secondary">Filtreyle eşleşen kayıt yok.</p>
        ) : (
          <ul className="divide-y divide-line">
            {auditRows.map((row) => (
              <AuditRowItem key={row.id} row={row} />
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-xs text-text-secondary">
            <span>
              Sayfa {page} / {totalPages}
            </span>

            <div className="flex gap-2">
              {page > 1 && (
                <a
                  href={buildQuery({ page: String(page - 1) })}
                  className="rounded-lg border border-border px-3 py-1.5 font-medium text-text-primary transition hover:bg-surface-muted"
                >
                  Önceki
                </a>
              )}

              {page < totalPages && (
                <a
                  href={buildQuery({ page: String(page + 1) })}
                  className="rounded-lg border border-border px-3 py-1.5 font-medium text-text-primary transition hover:bg-surface-muted"
                >
                  Sonraki
                </a>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function AuditRowItem({ row }: { row: AuditRow }) {
  const diffRows = computeDiff(row.old_data, row.new_data);

  return (
    <li className="py-3">
      <details>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="whitespace-nowrap text-xs text-text-secondary">
            {formatDateTime(row.created_at)}
          </span>
          <span className="font-medium text-text-primary">
            {row.profiles?.full_name ?? "Sistem"}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-secondary">
            {tableLabels[row.table_name] ?? row.table_name}
          </span>
          <span className="text-xs text-text-secondary">{actionLabel(row.action)}</span>
          {row.record_id && (
            <span className="font-mono text-xs text-text-secondary">
              #{row.record_id.slice(0, 8)}
            </span>
          )}
        </summary>

        <div className="mt-2 pl-1">
          {diffRows.length === 0 ? (
            <p className="text-xs text-text-secondary">Karşılaştırılacak alan yok.</p>
          ) : (
            <table className="w-full max-w-2xl text-left text-xs">
              <thead>
                <tr className="border-b border-border text-text-secondary">
                  <th className="py-1.5 pr-3">Alan</th>
                  <th className="py-1.5 pr-3">Önceki</th>
                  <th className="py-1.5">Sonraki</th>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((diff) => (
                  <tr key={diff.key} className="border-b border-border/60">
                    <td className="py-1.5 pr-3 font-medium text-text-primary">
                      {fieldLabel(diff.key)}
                      {isSensitiveAuditKey(diff.key) && (
                        <span className="ml-1 text-danger text-danger">🔒</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-text-secondary">{diff.oldValue}</td>
                    <td className="py-1.5 text-text-primary">{diff.newValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </li>
  );
}

function computeDiff(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
) {
  const old = oldData ?? {};
  const next = newData ?? {};
  const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])];

  return keys
    .filter((key) => JSON.stringify(old[key]) !== JSON.stringify(next[key]))
    .map((key) => ({
      key,
      oldValue: key in old ? formatAuditValue(key, old[key]) : "—",
      newValue: key in next ? formatAuditValue(key, next[key]) : "—",
    }));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
