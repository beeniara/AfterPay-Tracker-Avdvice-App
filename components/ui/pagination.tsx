import Link from "next/link";
import { cn } from "@/lib/cn";

type PaginationProps = {
  totalResults: number;
  offset: number;
  limit: number;
  hrefFor: (offset: number) => string;
};

function pageNumbers(current: number, last: number): (number | "…")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const pages = new Set<number>([1, last, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (page - previous > 1) out.push("…");
    out.push(page);
    previous = page;
  }
  return out;
}

export function Pagination({ totalResults, offset, limit, hrefFor }: PaginationProps) {
  const last = Math.max(1, Math.ceil(totalResults / limit));
  const current = Math.floor(offset / limit) + 1;
  if (last <= 1) return null;

  const item = "grid size-8 place-items-center rounded-chip text-[13px]";
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-1">
      {current > 1 ? (
        <Link href={hrefFor((current - 2) * limit)} className={cn(item, "text-ink-muted hover:bg-surface-chip")} aria-label="Previous page">
          ‹
        </Link>
      ) : (
        <span className={cn(item, "text-ink-subtle")} aria-hidden="true">‹</span>
      )}
      {pageNumbers(current, last).map((page, index) =>
        page === "…" ? (
          <span key={`gap-${index}`} className={cn(item, "text-ink-subtle")} aria-hidden="true">
            …
          </span>
        ) : (
          <Link
            key={page}
            href={hrefFor((page - 1) * limit)}
            aria-current={page === current ? "page" : undefined}
            className={cn(
              item,
              page === current
                ? "bg-prominent font-semibold text-inverse"
                : "text-ink-muted hover:bg-surface-chip",
            )}
          >
            {page}
          </Link>
        ),
      )}
      {current < last ? (
        <Link href={hrefFor(current * limit)} className={cn(item, "text-ink-muted hover:bg-surface-chip")} aria-label="Next page">
          ›
        </Link>
      ) : (
        <span className={cn(item, "text-ink-subtle")} aria-hidden="true">›</span>
      )}
    </nav>
  );
}
