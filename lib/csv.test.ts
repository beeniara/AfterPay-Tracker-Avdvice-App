import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRows } from "./csv";

describe("parseCsvRows", () => {
  it("splits simple rows", () => {
    expect(parseCsvRows("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quotes, embedded commas, escaped quotes, CRLF and a BOM", () => {
    const text = '﻿name,note\r\n"Smith, Jo","said ""hi"""\r\nplain,';
    expect(parseCsvRows(text)).toEqual([
      ["name", "note"],
      ["Smith, Jo", 'said "hi"'],
      ["plain", ""],
    ]);
  });

  it("keeps newlines inside quoted fields and drops blank lines", () => {
    expect(parseCsvRows('a\n"line1\nline2"\n\n\nz')).toEqual([
      ["a"],
      ["line1\nline2"],
      ["z"],
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseCsvRows("")).toEqual([]);
    expect(parseCsvRows("\n\n")).toEqual([]);
  });
});

describe("parseCsv", () => {
  it("maps rows onto trimmed headers, padding short rows", () => {
    expect(parseCsv(" Date , Merchant\n2026-09-17, Kmart\n2026-09-16")).toEqual({
      headers: ["Date", "Merchant"],
      rows: [
        { Date: "2026-09-17", Merchant: "Kmart" },
        { Date: "2026-09-16", Merchant: "" },
      ],
    });
  });

  it("returns empty headers for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});
