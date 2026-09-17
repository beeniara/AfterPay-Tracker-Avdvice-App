import { describe, expect, it } from "vitest";
import {
  addDays,
  assertIsoDate,
  daysBetween,
  isIsoDate,
  todayIso,
  toIsoDate,
} from "./dates";

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-05-05", 0)).toBe("2026-05-05");
  });
});

describe("daysBetween", () => {
  it("is signed", () => {
    expect(daysBetween("2026-09-17", "2026-09-24")).toBe(7);
    expect(daysBetween("2026-09-24", "2026-09-17")).toBe(-7);
    expect(daysBetween("2026-09-17", "2026-09-17")).toBe(0);
  });
});

describe("validation", () => {
  it("accepts ISO dates and rejects everything else", () => {
    expect(isIsoDate("2026-09-17")).toBe(true);
    expect(isIsoDate("17/09/2026")).toBe(false);
    expect(assertIsoDate("2026-09-17")).toBe("2026-09-17");
    expect(() => assertIsoDate("2026-9-17")).toThrow(/YYYY-MM-DD/);
    expect(() => addDays("nope", 1)).toThrow();
    expect(() => daysBetween("2026-09-17", "nope")).toThrow();
  });
});

describe("toIsoDate / todayIso", () => {
  it("uses the wall-clock date in the given time zone", () => {
    const instant = new Date("2026-09-17T11:30:00Z"); // 23:30 NZST same day
    expect(toIsoDate(instant, "Pacific/Auckland")).toBe("2026-09-17");
    expect(toIsoDate(new Date("2026-09-17T12:30:00Z"), "Pacific/Auckland")).toBe(
      "2026-09-18",
    );
    expect(toIsoDate(instant, "UTC")).toBe("2026-09-17");
  });

  it("defaults to the app time zone", () => {
    expect(isIsoDate(todayIso())).toBe(true);
    expect(isIsoDate(toIsoDate(new Date()))).toBe(true);
  });
});
