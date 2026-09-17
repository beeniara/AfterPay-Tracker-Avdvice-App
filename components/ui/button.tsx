import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "prominent" | "primary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-pill px-[18px] py-[9px] text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  prominent: "bg-prominent text-inverse hover:opacity-90",
  primary: "bg-primary text-ink hover:bg-primary-press",
  ghost: "border border-line bg-surface text-ink hover:bg-surface-chip",
};

export function buttonClasses(variant: Variant = "prominent", className?: string) {
  return cn(base, variants[variant], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

export function Button({
  variant = "prominent",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={buttonClasses(variant, className)} {...props} />
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: Variant;
  children: ReactNode;
};

export function ButtonLink({
  variant = "prominent",
  className,
  ...props
}: ButtonLinkProps) {
  return <Link className={buttonClasses(variant, className)} {...props} />;
}
