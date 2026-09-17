export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsvRows(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source.charAt(i);
    if (inQuotes) {
      if (char === '"') {
        if (source.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source.charAt(i + 1) === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ""));
}

export function parseCsv(text: string): ParsedCsv {
  const [headerRow, ...body] = parseCsvRows(text);
  if (!headerRow) return { headers: [], rows: [] };
  const headers = headerRow.map((h) => h.trim());
  const rows = body.map((cells) =>
    Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()])),
  );
  return { headers, rows };
}
