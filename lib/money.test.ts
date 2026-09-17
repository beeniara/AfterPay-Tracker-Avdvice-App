import { describe, expect, it } from "vitest";
import {
  addMoney,
  CurrencyMismatchError,
  formatMoney,
  fromMoney,
  InvalidMoneyError,
  minorUnits,
  parseAmount,
  sumCents,
  symbolFor,
  toMoney,
} from "./money";

describe("toMoney", () => {
  it("renders cents as a two-decimal string with symbol", () => {
    expect(toMoney(4000, "NZD")).toEqual({
      amount: "40.00",
      currency: "NZD",
      symbol: "$",
    });
  });

  it("pads small fractions", () => {
    expect(toMoney(5, "NZD").amount).toBe("0.05");
    expect(toMoney(100, "NZD").amount).toBe("1.00");
    expect(toMoney(0, "NZD").amount).toBe("0.00");
  });

  it("handles negative amounts", () => {
    expect(toMoney(-4025, "NZD").amount).toBe("-40.25");
    expect(toMoney(-5, "NZD").amount).toBe("-0.05");
  });

  it("respects zero-decimal currencies", () => {
    expect(minorUnits("JPY")).toBe(0);
    expect(toMoney(1234, "JPY")).toEqual({
      amount: "1234",
      currency: "JPY",
      symbol: "¥",
    });
  });

  it("rejects non-integer cents", () => {
    expect(() => toMoney(1.5, "NZD")).toThrow(InvalidMoneyError);
    expect(() => toMoney(Number.NaN, "NZD")).toThrow(InvalidMoneyError);
  });

  it("rejects bad currency codes", () => {
    expect(() => toMoney(1, "nzd")).toThrow(InvalidMoneyError);
    expect(() => toMoney(1, "DOLLARS")).toThrow(InvalidMoneyError);
  });
});

describe("symbolFor", () => {
  it("knows common symbols", () => {
    expect(symbolFor("NZD")).toBe("$");
    expect(symbolFor("GBP")).toBe("£");
    expect(symbolFor("EUR")).toBe("€");
  });
});

describe("fromMoney", () => {
  it("round-trips toMoney", () => {
    for (const cents of [0, 1, 99, 100, 12345, -12345, 999999999]) {
      expect(fromMoney(toMoney(cents, "NZD"))).toEqual({ cents, currency: "NZD" });
    }
  });

  it("accepts short and missing fractions", () => {
    expect(fromMoney({ amount: "40", currency: "NZD" }).cents).toBe(4000);
    expect(fromMoney({ amount: "40.5", currency: "NZD" }).cents).toBe(4050);
    expect(fromMoney({ amount: "40.", currency: "NZD" }).cents).toBe(4000);
    expect(fromMoney({ amount: " 7.25 ", currency: "NZD" }).cents).toBe(725);
  });

  it("does not drift on values that are inexact as floats", () => {
    expect(fromMoney({ amount: "0.1", currency: "NZD" }).cents).toBe(10);
    expect(fromMoney({ amount: "1234", currency: "JPY" }).cents).toBe(1234);
    expect(() => fromMoney({ amount: "1.005", currency: "NZD" })).toThrow(
      /more than 2 decimal places/,
    );
    expect(() => fromMoney({ amount: "12.5", currency: "JPY" })).toThrow(
      /more than 0 decimal places/,
    );
  });

  it("rejects garbage", () => {
    for (const amount of ["", "abc", "1,000.00", "$5", "5-", "--5", "1e3"]) {
      expect(() => fromMoney({ amount, currency: "NZD" })).toThrow(InvalidMoneyError);
    }
  });

  it("rejects amounts beyond safe integer range", () => {
    expect(() =>
      fromMoney({ amount: "99999999999999999", currency: "NZD" }),
    ).toThrow(/too large/);
  });
});

describe("parseAmount", () => {
  it("strips symbols and separators", () => {
    expect(parseAmount("$1,234.50", "NZD").cents).toBe(123450);
    expect(parseAmount("NZ$ 40.00", "NZD").cents).toBe(4000);
    expect(parseAmount("-12.30", "NZD").cents).toBe(-1230);
  });
});

describe("addMoney / sumCents", () => {
  it("adds in integer cents", () => {
    expect(addMoney(toMoney(1010, "NZD"), toMoney(2020, "NZD")).amount).toBe("30.30");
    expect(addMoney(toMoney(10, "NZD"), toMoney(-20, "NZD")).amount).toBe("-0.10");
  });

  it("throws when currencies are mixed", () => {
    expect(() => addMoney(toMoney(100, "NZD"), toMoney(100, "AUD"))).toThrow(
      CurrencyMismatchError,
    );
    expect(() =>
      sumCents([{ cents: 1, currency: "NZD" }, { cents: 1, currency: "USD" }], "NZD"),
    ).toThrow(/Cannot combine NZD with USD/);
  });

  it("sums an empty list to zero in the requested currency", () => {
    expect(sumCents([], "AUD")).toEqual({ cents: 0, currency: "AUD" });
  });
});

describe("formatMoney", () => {
  it("formats for display with the currency symbol", () => {
    expect(formatMoney(toMoney(123456, "NZD"))).toBe("$1,234.56");
    expect(formatMoney(toMoney(-500, "NZD"))).toBe("-$5.00");
    expect(formatMoney(toMoney(500, "GBP"), "en-GB")).toBe("£5.00");
  });
});
