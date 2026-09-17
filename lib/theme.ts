export type ThemeMode = "light" | "dark" | "system";

export interface ThemeChoice {
  hue: number;
  mode: ThemeMode;
}

export const THEME_STORAGE_KEY = "owing.theme";
export const DEFAULT_THEME: ThemeChoice = { hue: 244, mode: "system" };

export const THEME_PRESETS = [
  { name: "Periwinkle", hue: 244 },
  { name: "Mint", hue: 160 },
  { name: "Sky", hue: 205 },
  { name: "Lime", hue: 95 },
  { name: "Peach", hue: 25 },
  { name: "Rose", hue: 340 },
] as const;

export function readTheme(): ThemeChoice {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<ThemeChoice>;
    return {
      hue: typeof parsed.hue === "number" ? parsed.hue : DEFAULT_THEME.hue,
      mode:
        parsed.mode === "light" || parsed.mode === "dark" || parsed.mode === "system"
          ? parsed.mode
          : DEFAULT_THEME.mode,
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: ThemeChoice): void {
  const root = document.documentElement;
  root.style.setProperty("--theme-hue", String(theme.hue));
  if (resolveMode(theme.mode) === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

export function saveTheme(theme: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Storage can be unavailable; the theme still applies for this page view.
  }
}

// Runs inline before first paint so the stored theme never flashes.
export const THEME_BOOT_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"null");if(!t)return;var d=document.documentElement;if(typeof t.hue==="number")d.style.setProperty("--theme-hue",String(t.hue));var m=t.mode==="system"||!t.mode?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t.mode;if(m==="dark")d.setAttribute("data-theme","dark");}catch(e){}})();`;
