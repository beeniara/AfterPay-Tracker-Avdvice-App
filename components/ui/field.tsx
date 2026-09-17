import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const inputClass =
  "h-9 w-full rounded-chip border border-line bg-surface px-3 text-body text-ink placeholder:text-ink-subtle disabled:opacity-60";

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-caption text-ink-muted", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-ink-subtle">{hint}</span> : null}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-chip bg-danger-tint px-3 py-2 text-caption whitespace-pre-line text-danger">
      {message}
    </p>
  );
}
