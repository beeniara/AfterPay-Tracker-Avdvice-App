import { describe, expect, it } from "vitest";
import { colorSeedFor, initialsFor } from "./color-seed";

describe("colorSeedFor", () => {
  it("is deterministic, case-insensitive and within 0-359", () => {
    expect(colorSeedFor("Glimmer Goods")).toBe(colorSeedFor("  glimmer goods "));
    for (const name of ["a", "Northwind Finance", "🙂 shop", ""]) {
      const seed = colorSeedFor(name);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(360);
    }
    expect(colorSeedFor("Alpha")).not.toBe(colorSeedFor("Beta"));
  });
});

describe("initialsFor", () => {
  it("takes the first letter of the first words", () => {
    expect(initialsFor("Glimmer Goods")).toBe("GG");
    expect(initialsFor("DD *Deliverish PizzaCo")).toBe("DD");
    expect(initialsFor("solo")).toBe("S");
    expect(initialsFor("Three Word Name", 3)).toBe("TWN");
    expect(initialsFor("")).toBe("");
  });
});
