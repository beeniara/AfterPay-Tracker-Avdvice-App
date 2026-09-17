export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-[5px] w-full overflow-hidden rounded-pill bg-surface-chip"
    >
      <div className="h-full rounded-pill bg-prominent" style={{ width: `${percent}%` }} />
    </div>
  );
}
