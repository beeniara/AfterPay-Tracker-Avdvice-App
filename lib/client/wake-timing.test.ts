import { describe, expect, it } from "vitest";
import { describeWake } from "./wake-timing";

describe("describeWake", () => {
  it("notes the first timed start", () => {
    expect(describeWake(40, null)).toMatch(/first start/);
  });
  it("calls a big improvement much quicker", () => {
    expect(describeWake(30, 60)).toBe("It took 30 seconds to start, 30 seconds quicker than last time. Much quicker!");
  });
  it("calls a small improvement a little quicker", () => {
    expect(describeWake(50, 60)).toMatch(/10 seconds quicker.*A little quicker/);
  });
  it("treats near-identical times as the same", () => {
    expect(describeWake(59, 60)).toMatch(/about the same/);
  });
  it("flags a slower start", () => {
    expect(describeWake(90, 45)).toMatch(/45 seconds slower.*Much slower/);
  });
  it("uses the singular for one second", () => {
    expect(describeWake(1, null)).toMatch(/took 1 second to/);
  });
});
