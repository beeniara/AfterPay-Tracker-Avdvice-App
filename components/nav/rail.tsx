"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarIcon,
  HomeIcon,
  OrdersIcon,
  ProvidersIcon,
  SettingsIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

const items = [
  { href: "/", label: "Dashboard", Icon: HomeIcon },
  { href: "/orders", label: "Orders", Icon: OrdersIcon },
  { href: "/upcoming", label: "Upcoming", Icon: CalendarIcon },
  { href: "/providers", label: "Providers", Icon: ProvidersIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Rail() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 flex w-60 flex-col px-4 py-7">
      <Link
        href="/"
        className="mb-7 px-3 text-heading font-bold tracking-tight text-ink"
      >
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
                    active
                      ? "bg-primary text-ink"
                      : "text-ink-secondary hover:bg-surface-chip hover:text-ink",
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
    </aside>
  );
}
