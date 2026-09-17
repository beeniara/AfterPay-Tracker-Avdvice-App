import Link from "next/link";
import { SearchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { OrderFilters } from "@/lib/api/params";
import type { Provider } from "@/lib/db/schema";

const STATUSES = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "settled", label: "Paid" },
] as const;

const field =
  "h-9 rounded-chip border border-line bg-surface px-3 text-body text-ink placeholder:text-ink-subtle";

export function FilterBar({
  filters,
  providers,
  hasFilters,
}: {
  filters: OrderFilters;
  providers: Provider[];
  hasFilters: boolean;
}) {
  return (
    <form method="get" action="/orders" className="mb-5 flex flex-wrap items-end gap-3">
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-caption text-ink-muted">
        Search
        <span className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Merchant, order number or provider"
            className={`${field} w-full pl-9`}
          />
        </span>
      </label>
      {providers.length > 1 ? (
        <label className="flex flex-col gap-1 text-caption text-ink-muted">
          Provider
          <select name="providerId" defaultValue={filters.providerId ?? ""} className={field}>
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <fieldset className="flex flex-col gap-1 text-caption text-ink-muted">
        <legend className="mb-1">Status</legend>
        <div className="flex h-9 items-center rounded-chip border border-line bg-surface p-0.5">
          {STATUSES.map((s) => (
            <label key={s.value} className="cursor-pointer">
              <input
                type="radio"
                name="status"
                value={s.value}
                defaultChecked={(filters.status ?? "") === s.value}
                className="peer sr-only"
              />
              <span className="block rounded-[7px] px-3 py-1 text-caption font-medium text-ink-muted peer-checked:bg-prominent peer-checked:text-inverse peer-focus-visible:outline-2 peer-focus-visible:outline-prominent">
                {s.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-caption text-ink-muted">
        From
        <input type="date" name="from" defaultValue={filters.from ?? ""} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-caption text-ink-muted">
        To
        <input type="date" name="to" defaultValue={filters.to ?? ""} className={field} />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit">Apply</Button>
        {hasFilters ? (
          <Link href="/orders" className="text-caption font-medium text-ink-muted underline underline-offset-2">
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
