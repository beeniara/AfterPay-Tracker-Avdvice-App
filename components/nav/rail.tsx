"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  CalendarIcon,
  HomeIcon,
  InsightsIcon,
  OrdersIcon,
  ProvidersIcon,
  SettingsIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

const items = [
  { href: "/", label: "Dashboard", Icon: HomeIcon },
  { href: "/orders", label: "Orders", Icon: OrdersIcon },
  { href: "/upcoming", label: "Upcoming", Icon: CalendarIcon },
  { href: "/insights", label: "Insights", Icon: InsightsIcon },
  { href: "/providers", label: "Providers", Icon: ProvidersIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Rail({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col px-4 py-7 rail:flex">
        <Link href="/" className="mb-7 px-3 text-heading font-bold tracking-tight text-ink">
          Owing
        </Link>
        <nav aria-label="Primary">
          <ul className="flex flex-col gap-0.5">
            {items.map(({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-pill px-3 py-2.5 text-body font-medium transition-colors",
                      active ? "bg-primary text-ink" : "text-ink-secondary hover:bg-surface-chip hover:text-ink",
                    )}
                  >
                    <Icon className="size-[17px] shrink-0" />
                    <span>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto px-3">
          <div className="truncate text-caption font-medium text-ink-secondary" title={userName}>{userName}</div>
          <SignOutButton />
        </div>
      </aside>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur rail:hidden"
      >
        <ul className="grid grid-cols-6">
          {items.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                    active ? "text-ink" : "text-ink-muted",
                  )}
                >
                  <span className={cn("grid h-7 w-12 place-items-center rounded-pill", active && "bg-primary")}>
                    <Icon className="size-[18px]" />
                  </span>
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
