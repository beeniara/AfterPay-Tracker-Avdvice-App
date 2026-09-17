import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { OrderStatus } from "@/lib/ledger";

type BadgeTone = "prominent" | "success" | "warning" | "danger" | "neutral";

const tones: Record<BadgeTone, string> = {
  prominent: "bg-prominent text-inverse",
  success: "bg-success-tint text-success",
  warning: "bg-warning-tint text-warning",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-surface-chip text-ink-secondary",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block rounded-[5px] px-2 py-[3px] text-[10.5px] font-bold tracking-wide",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const statusLabels: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "prominent" },
  settled: { label: "Paid", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { label, tone } = statusLabels[status];
  return <Badge tone={tone}>{label}</Badge>;
}
