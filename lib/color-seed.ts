// Deterministic 0-359 hue from a name, so initial chips stay stable.
export function colorSeedFor(name: string): number {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % 360;
}

export function initialsFor(name: string, max = 2): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .slice(0, max)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
