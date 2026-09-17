import { describe, expect, it } from "vitest";
import { prepareImport, type ImportOptions } from "./orders";

const options: ImportOptions = {
  providerName: "Northwind Pay",
  providerKind: "bnpl",
  currency: "NZD",
  instalmentCount: 4,
  intervalDays: 14,
  replace: false,
};

const row = (overrides: Partial<Parameters<typeof prepareImport>[0][number]> = {}) => ({
  date: "2026-08-26",
  merchant: "Glimmer Goods",
  reference: "A-1",
  totalAmount: "120.75",
  amountOwing: "60.37",
  channel: "In-Store",
  status: "Active",
  ...overrides,
});

describe("prepareImport", () => {
  it("reconstructs schedules and allocates payments", () => {
    const plan = prepareImport([row()], options);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0]).toMatchObject({
      merchant: "Glimmer Goods",
      channel: "in_store",
      total: 12075,
      owing: 6037,
      paid: [3019, 3019, 0, 0],
    });
    expect(plan.rows[0]?.schedule.map((s) => s.dueOn)).toEqual([
      "2026-08-26",
      "2026-09-09",
      "2026-09-23",
      "2026-10-07",
    ]);
    expect(plan).toMatchObject({ totalCents: 12075, owingCents: 6037, statusMismatches: 0 });
  });

  it("aligns to a fortnightly cycle when an anchor is given", () => {
    const plan = prepareImport([row()], { ...options, cycleAnchor: "2026-09-24" });
    expect(plan.rows[0]?.schedule.map((s) => s.dueOn)).toEqual([
      "2026-08-27",
      "2026-09-10",
      "2026-09-24",
      "2026-10-08",
    ]);
  });

  it("accepts d/m/y dates and flags status disagreements", () => {
    const plan = prepareImport(
      [
        row({ date: "26/08/2026", status: "Completed" }),
        row({ reference: "A-2", date: "2026.08.01", amountOwing: "0", status: "Completed" }),
      ],
      options,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.rows.map((r) => r.purchasedOn)).toEqual(["2026-08-26", "2026-08-01"]);
    expect(plan.statusMismatches).toBe(1);
  });

  it("collects row errors instead of aborting", () => {
    const plan = prepareImport(
      [
        row({ date: "yesterday" }),
        row({ reference: "", date: "2026-01-01" }),
        row({ reference: "A-3", amountOwing: "999" }),
        row({ reference: "A-4", totalAmount: "abc" }),
        row({ reference: "A-5" }),
        row({ reference: "A-5" }),
      ],
      options,
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 7]);
    expect(plan.errors[0]?.message).toMatch(/Unrecognised date/);
    expect(plan.errors[2]?.message).toMatch(/between 0 and the order amount/);
    expect(plan.errors[4]?.message).toMatch(/Duplicate/);
  });
});
