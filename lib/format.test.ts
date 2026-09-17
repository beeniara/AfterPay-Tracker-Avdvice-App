import { describe, expect, it } from "vitest";
import { describeDue, formatCents, formatDate, ordinalOf } from "./format";

describe("formatCents", () => {
  it("formats minor units with the currency symbol", () => {
    expect(formatCents(127378, "NZD")).toBe("$1,273.78");
    expect(formatCents(0, "NZD")).toBe("$0.00");
  });
});

describe("formatDate", () => {
  it("formats calendar dates without time-zone drift", () => {
    expect(formatDate("2026-09-24")).toBe("24 Sept 2026");
    expect(formatDate("2026-09-24", "long")).toBe("Thu, 24 Sept 2026");
    expect(formatDate("2026-09-24", "dayMonth")).toBe("Thu, 24 Sept");
  });

  it("formats instants in the app time zone", () => {
    expect(formatDate(new Date("2026-09-16T13:00:00Z"))).toBe("17 Sept 2026");
    expect(formatDate(new Date("2026-09-16T13:00:00Z"), "short", "UTC")).toBe(
      "16 Sept 2026",
    );
  });
});

describe("describeDue", () => {
  const today = "2026-09-17";

  it("frames time as urgency", () => {
    expect(describeDue("2026-09-17", today)).toMatchObject({ label: "Today", tone: "warning" });
    expect(describeDue("2026-09-18", today)).toMatchObject({ label: "Tomorrow", tone: "warning" });
    expect(describeDue("2026-09-24", today)).toMatchObject({ label: "In 7 days", tone: "warning" });
    expect(describeDue("2026-10-17", today)).toMatchObject({ label: "In 30 days", tone: "neutral" });
    expect(describeDue("2026-09-16", today)).toMatchObject({ label: "Yesterday", tone: "danger" });
    expect(describeDue("2026-09-10", today)).toMatchObject({
      label: "7 days overdue",
      tone: "danger",
      days: -7,
    });
  });
});

describe("ordinalOf", () => {
  it("reads as 'n of count'", () => {
    expect(ordinalOf(3, 4)).toBe("3 of 4");
  });
});
