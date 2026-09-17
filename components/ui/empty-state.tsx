import type { ReactNode } from "react";

type EmptyStateProps = {
  glyph: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ glyph, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center py-10 text-center">
      <div
        aria-hidden="true"
        className="mb-4 grid size-16 place-items-center rounded-card bg-surface-chip text-hero text-ink-subtle"
      >
        {glyph}
      </div>
      <h3 className="text-heading">{title}</h3>
      <p className="mt-1 max-w-sm text-body text-ink-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
