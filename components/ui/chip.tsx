import { cn } from "@/lib/cn";
import { colorSeedFor, initialsFor } from "@/lib/color-seed";

type ChipProps = {
  name: string;
  hue?: number;
  size?: "md" | "lg";
  className?: string;
};

export function Chip({ name, hue, size = "md", className }: ChipProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "chip",
        size === "lg"
          ? "size-[46px] rounded-[12px] text-[12px]"
          : "size-[34px] rounded-chip text-[10.5px]",
        className,
      )}
      style={{ "--chip-hue": hue ?? colorSeedFor(name) } as React.CSSProperties}
    >
      {initialsFor(name)}
    </span>
  );
}
