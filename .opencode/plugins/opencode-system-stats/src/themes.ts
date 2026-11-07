import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import * as yaml from "js-yaml"
import type { CustomTheme } from "./rpc.js"

/**
 * User custom themes.
 *
 * Themes live OUTSIDE the plugin directory (in the path given by
 * `SYSTEM_STATS_THEME_DIR`) so they survive plugin updates. Each `*.yaml`/`*.yml`
 * file defines one theme. This module scans that directory, parses and
 * validates every file, and returns only the valid ones. Every problem is
 * reported with `console.warn` and skipped — a single bad file (or a missing
 * directory) never aborts loading of the others. The caller (the RPC method in
 * `index.ts`) turns the returned array into `{ themes }`.
 */

// `#fff` or `#ff8800` (3- or 6-digit hex). Anything else fails validation.
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
// Stable id: starts alphanumeric, then letters/digits/dot/dash/underscore.
const NAME_OK = /^[a-z0-9][a-z0-9._-]*$/

// The seven phosphor fields every palette must define as hex strings.
const PALETTE_KEYS = [
  "bg",
  "accent",
  "base",
  "muted",
  "warn",
  "crit",
  "border",
] as const

type PaletteKey = (typeof PALETTE_KEYS)[number]

interface RawPalette {
  bg: string
  accent: string
  base: string
  muted: string
  warn: string
  crit: string
  border: string
}

/** Read one hex field; returns `null` when missing or not a valid hex color. */
function readHex(obj: unknown, key: PaletteKey): string | null {
  const v = (obj as Record<string, unknown> | undefined)?.[key]
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim() : null
}

/** Parse/validate the `palette` block. `null` when any field is missing/bad. */
function parsePalette(raw: unknown): RawPalette | null {
  if (!raw || typeof raw !== "object") return null
  const out = {} as RawPalette
  for (const key of PALETTE_KEYS) {
    const hex = readHex(raw, key)
    if (!hex) return null
    out[key] = hex
  }
  return out
}

/**
 * Turn a parsed YAML document into a theme. Returns `null` (after warning) when
 * the document is not a valid theme.
 *
 * `name` comes from the `name:` field, else the filename stem; it must match
 * `NAME_OK`. `label` is optional and falls back to `name`.
 */
function themeFromDoc(doc: unknown, file: string): CustomTheme | null {
  if (!doc || typeof doc !== "object") {
    console.warn(`[system-stats] ${file}: not a mapping, skipping`)
    return null
  }
  const d = doc as Record<string, unknown>

  const palette = parsePalette(d.palette)
  if (!palette) {
    console.warn(
      `[system-stats] ${file}: palette invalid — needs bg,accent,base,muted,warn,crit,border as hex (#fff / #ff8800)`,
    )
    return null
  }

  let name = typeof d.name === "string" ? d.name.trim() : ""
  if (!name) {
    // Fall back to the filename without extension, e.g. "sunset.yml" -> "sunset".
    name = file.replace(/\.ya?ml$/i, "")
  }
  if (!NAME_OK.test(name)) {
    console.warn(
      `[system-stats] ${file}: theme name "${d.name ?? name}" invalid — use lowercase, starting with a letter or digit (a-z0-9, then _ . -)`,
    )
    return null
  }

  const label =
    typeof d.label === "string" && d.label.trim() ? d.label.trim() : name

  return {
    name,
    label,
    custom: true,
    palette: palette as unknown as CustomTheme["palette"],
  }
}

/**
 * Load all valid themes from `dir`.
 *
 * - Missing dir / env var → warns once, returns `[]` (built-ins only).
 * - Non-`.yaml`/`.yml` files are ignored.
 * - Each file is parsed and validated; bad files are warned + skipped.
 * - Duplicate `name`s (across files) keep the first and warn on the rest.
 * - Returns themes in sorted-by-file order.
 */
export function loadThemes(dir: string | undefined): CustomTheme[] {
  if (!dir) {
    console.warn(
      "[system-stats] SYSTEM_STATS_THEME_DIR not set — using built-in themes only",
    )
    return []
  }

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    console.warn(`[system-stats] theme directory not found: ${dir}`)
    return []
  }

  const byName = new Map<string, CustomTheme>()

  for (const file of entries.sort()) {
    if (!/\.(ya?ml)$/i.test(file)) continue
    const path = join(dir, file)
    let text: string
    try {
      // Skip directories that happen to end in .yaml.
      if (!statSync(path).isFile()) continue
      text = readFileSync(path, "utf8")
    } catch (err) {
      console.warn(`[system-stats] cannot read ${file}:`, err)
      continue
    }

    let doc: unknown
    try {
      doc = yaml.load(text)
    } catch (err) {
      console.warn(`[system-stats] ${file}: invalid YAML:`, err)
      continue
    }

    const theme = themeFromDoc(doc, file)
    if (!theme) continue
    if (byName.has(theme.name)) {
      console.warn(
        `[system-stats] ${file}: duplicate theme name "${theme.name}" — keeping the first definition, skipping this file`,
      )
      continue
    }
    byName.set(theme.name, theme)
  }

  return [...byName.values()]
}
