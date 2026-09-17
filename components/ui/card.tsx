import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return (
    <section
      className={cn("mt-4 rounded-card bg-surface px-7 py-6", className)}
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
