"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/format";

type Period = { period: number; total: number };

export function BreakdownDialog({ periods, currency }: { periods: Period[]; currency: string }) {
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button onClick={() => ref.current?.showModal()}>Breakdown</Button>
      <dialog
        ref={ref}
        aria-labelledby="breakdown-title"
        className="m-auto w-[min(92vw,380px)] rounded-card bg-surface p-7 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <h2 id="breakdown-title" className="text-heading">
          What&apos;s due soon
        </h2>
        <dl className="mt-4">
          {periods.map((p) => (
            <div key={p.period} className="flex items-baseline justify-between border-b border-line py-3 last:border-b-0">
              <dt className="text-body text-ink-secondary">Due in {p.period} days</dt>
              <dd className="text-heading tabular-nums">{formatCents(p.total, currency)}</dd>
            </div>
          ))}
        </dl>
        <form method="dialog" className="mt-5 flex justify-end">
          <Button variant="ghost" type="submit">Close</Button>
        </form>
      </dialog>
    </>
  );
}
