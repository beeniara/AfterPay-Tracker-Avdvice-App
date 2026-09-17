import { daysBetween, DEFAULT_TIME_ZONE } from "@/lib/dates";
import { formatMoney, toMoney } from "@/lib/money";

export function formatCents(
  cents: number,
  currency: string,
  locale = "en-NZ",
): string {
  return formatMoney(toMoney(cents, currency), locale);
}

const DATE_STYLES = {
  short: { day: "numeric", month: "short", year: "numeric" },
  long: { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  dayMonth: { weekday: "short", day: "numeric", month: "short" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof DATE_STYLES;

// ISO date strings are calendar dates and format as-is; Date instants are
// shown in the app time zone.
export function formatDate(
  value: string | Date,
  style: DateStyle = "short",
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const isCalendarDate = typeof value === "string";
  const instant = isCalendarDate ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat("en-NZ", {
    ...DATE_STYLES[style],
    timeZone: isCalendarDate ? "UTC" : timeZone,
  }).format(instant);
}

export type Tone = "neutral" | "warning" | "danger" | "success";

export interface DueDescription {
  label: string;
  tone: Tone;
  days: number;
}

export function describeDue(dueOn: string, today: string): DueDescription {
  const days = daysBetween(today, dueOn);
  if (days === 0) return { label: "Today", tone: "warning", days };
  if (days === 1) return { label: "Tomorrow", tone: "warning", days };
  if (days === -1) return { label: "Yesterday", tone: "danger", days };
  if (days < 0) return { label: `${-days} days overdue`, tone: "danger", days };
  return { label: `In ${days} days`, tone: days <= 7 ? "warning" : "neutral", days };
}

export function ordinalOf(sequence: number, count: number): string {
  return `${sequence} of ${count}`;
}
