"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import {
  applyTheme,
  DEFAULT_THEME,
  readTheme,
  saveTheme,
  THEME_PRESETS,
  type ThemeChoice,
  type ThemeMode,
} from "@/lib/theme";

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

export function ThemeControls() {
  const [theme, setTheme] = useState<ThemeChoice>(DEFAULT_THEME);
  const [loaded, setLoaded] = useState(false);
  const hueId = useId();

  useEffect(() => {
    setTheme(readTheme());
    setLoaded(true);
  }, []);

  function update(next: Partial<ThemeChoice>) {
    const merged = { ...theme, ...next };
    setTheme(merged);
    applyTheme(merged);
    saveTheme(merged);
  }

  return (
    <div className={cn("space-y-6", !loaded && "opacity-60")} aria-busy={!loaded}>
      <fieldset>
        <legend className="mb-3 text-body font-semibold">Accent colour</legend>
        <div className="flex flex-wrap gap-3">
          {THEME_PRESETS.map((preset) => {
            const active = preset.hue === theme.hue;
            return (
              <button
                key={preset.name}
                type="button"
                aria-pressed={active}
                onClick={() => update({ hue: preset.hue })}
                className={cn(
                  "flex items-center gap-2 rounded-pill border py-1.5 pr-3.5 pl-1.5 text-caption font-medium",
                  active
                    ? "border-prominent bg-surface-chip"
                    : "border-line hover:bg-surface-chip",
                )}
              >
                <span
                  aria-hidden="true"
                  className="swatch size-5 rounded-full"
                  style={{ "--swatch-hue": preset.hue } as React.CSSProperties}
                />
                {preset.name}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <label htmlFor={hueId} className="text-caption text-ink-muted">
            Custom hue
          </label>
          <input
            id={hueId}
            type="range"
            min={0}
            max={359}
            value={theme.hue}
            onChange={(event) => update({ hue: Number(event.target.value) })}
            className="hue-slider w-full max-w-xs"
          />
          <output htmlFor={hueId} className="w-10 text-right text-caption tabular-nums">
            {theme.hue}°
          </output>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-body font-semibold">Mode</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Colour mode">
          {MODES.map((mode) => {
            const active = mode.value === theme.mode;
            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ mode: mode.value })}
                className={cn(
                  "rounded-pill px-4 py-1.5 text-caption font-medium",
                  active ? "bg-prominent text-inverse" : "border border-line hover:bg-surface-chip",
                )}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <button
        type="button"
        onClick={() => update(DEFAULT_THEME)}
        className="text-caption font-medium text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        Reset to default
      </button>
    </div>
  );
}
