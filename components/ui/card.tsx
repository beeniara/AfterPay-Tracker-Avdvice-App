import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type CardTint = "surface" | "tint-1" | "tint-2" | "tint-3" | "tint-4" | "tint-5";

const tints: Record<CardTint, string> = {
  surface: "bg-surface",
  "tint-1": "bg-tint-1",
  "tint-2": "bg-tint-2",
  "tint-3": "bg-tint-3",
  "tint-4": "bg-tint-4",
  "tint-5": "bg-tint-5",
};

type CardProps = {
  children: ReactNode;
  className?: string;
  tint?: CardTint;
  // An anchor other parts of the page can link to, e.g. href="#ask".
  id?: string;
};

export function Card({ children, className, tint = "surface", id }: CardProps) {
  return (
    <section
      id={id}
      className={cn("mt-4 scroll-mt-4 rounded-card px-7 py-6", tints[tint], className)}
    >
      {children}
    </section>
  );
}

type HeroCardProps = CardProps & {
  heading: string;
};

export function HeroCard({ heading, children, className }: HeroCardProps) {
  return (
    <section
      className={cn("rounded-card bg-primary px-7 py-6 text-ink", className)}
    >
      <h2 className="mb-3 text-heading">{heading}</h2>
      <div className="flex flex-wrap gap-x-16 gap-y-4">{children}</div>
    </section>
  );
}

type HeroFigureProps = {
  label: string;
  value: string;
};

export function HeroFigure({ label, value }: HeroFigureProps) {
  return (
    <div>
      <div className="text-hero">{value}</div>
      <div className="mt-1 text-caption font-medium text-ink-secondary">
        {label}
      </div>
    </div>
  );
}
