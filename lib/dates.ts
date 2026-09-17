const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export const DEFAULT_TIME_ZONE = "Pacific/Auckland";

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function assertIsoDate(value: string): string {
  if (!ISO_DATE.test(value)) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${value}"`);
  }
  return value;
}

function toUtcMs(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
}

export function addDays(iso: string, days: number): string {
  assertIsoDate(iso);
  return new Date(toUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  assertIsoDate(from);
  assertIsoDate(to);
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function toIsoDate(
  instant: Date,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function todayIso(timeZone: string = DEFAULT_TIME_ZONE): string {
  return toIsoDate(new Date(), timeZone);
}
