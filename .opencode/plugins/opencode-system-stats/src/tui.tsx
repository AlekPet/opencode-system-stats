import { Show, createSignal, createEffect, createContext, useContext, onCleanup } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { Stats } from "./rpc.js"
import type { Stats as StatsSnapshot } from "./rpc.js"
import { formatGB } from "./stats.js"

const PANEL_ID = "system-stats"

const PRESETS = [
  { value: 200, label: "200 ms — fastest" },
  { value: 500, label: "500 ms — smooth" },
  { value: 1000, label: "1000 ms — default" },
  { value: 2000, label: "2000 ms — light" },
  { value: 5000, label: "5000 ms — background" },
]

// Retro 70s–90s early-computer phosphor palettes. Each theme is self-contained
// (no dependency on the host OS theme) so the "live terminal" look holds on
// dark or light hosts alike.
type ThemeName = "amber" | "green" | "mono"

interface Palette {
  bg: string
  accent: string
  base: string
  muted: string
  warn: string
  crit: string
  border: string
}

const THEMES: Record<ThemeName, { label: string; p: Palette }> = {
  amber: {
    label: "Amber CRT",
    p: { bg: "#1a1200", accent: "#ffb000", base: "#ffcc66", muted: "#b37a00", warn: "#ff9500", crit: "#ff5530", border: "#ffb000" },
  },
  green: {
    label: "Green Phosphor",
    p: { bg: "#001800", accent: "#33ff66", base: "#88ffaa", muted: "#1f9944", warn: "#aaff22", crit: "#ff3355", border: "#33ff66" },
  },
  mono: {
    label: "Mono IBM",
    p: { bg: "#0a0a0a", accent: "#ffffff", base: "#eeeeee", muted: "#8a8a8a", warn: "#ffff55", crit: "#ff5555", border: "#cccccc" },
  },
}
const THEME_NAMES = Object.keys(THEMES) as ThemeName[]
const THEME_LABEL = (name: ThemeName) => THEMES[name].label

// Options shared by the `/system-stats-refresh` command and by clicking the
// panel footer. Kept as a plain list so both call sites stay in sync.
const REFRESH_OPTIONS = PRESETS.map((p) => ({
  title: p.label,
  value: `${p.value}ms`,
}))

// Open the floating refresh-rate selector and apply the chosen interval.
// Shared by the palette command and the panel footer's `onClick`.
function applyRefreshRate(
  context: ReturnType<typeof usePlugin>,
  refreshMs: () => number,
  setRefreshMs: (ms: number) => void,
) {
  return context.ui.dialog
    .select({
      title: "Stats refresh rate",
      current: `${refreshMs()}ms`,
      options: REFRESH_OPTIONS,
    })
    .then((chosen) => {
      if (chosen) {
        const ms = Number.parseInt(chosen.replace(/ms$/, ""), 10)
        if (!Number.isNaN(ms) && ms > 0) setRefreshMs(ms)
      }
    })
}

// Open the theme selector dialog and persist the chosen palette.
// Shared by the palette command and the panel footer's theme switch.
function applyTheme(
  context: ReturnType<typeof usePlugin>,
  themeName: () => ThemeName,
  setTheme: (name: ThemeName) => void,
) {
  return context.ui.dialog
    .select({
      title: "System stats theme",
      current: THEME_LABEL(themeName()),
      options: THEME_NAMES.map((name) => ({ title: THEMES[name].label, value: name })),
    })
    .then((chosen) => {
      if (chosen) {
        const next = chosen as ThemeName
        if (THEMES[next]) setTheme(next)
      }
    })
}

function fmtTemp(c: number | null): string {
  return c == null ? "—" : `${Math.round(c)}°C`
}

// A single labeled stat row: label (muted) | value (right aligned).
// Colors come from the active phosphor `palette` (provided by the parent
// `Panel` via context), so the retro look is identical on dark and light hosts.
function StatRow(props: {
  label: string
  value: string
  accent?: string
}) {
  const palette = useContext(paletteCtx)
  return (
    <box flexDirection="row" alignItems="center" justifyContent="space-between">
      <text fg={palette().muted}>{props.label}</text>
      <text fg={props.accent ?? palette().base}>{props.value}</text>
    </box>
  )
}

// Palette provided to the panel body so `StatRow` can stay presentational.
const paletteCtx = createContext<() => Palette>()

export default Plugin.define({
  id: "opencode-system-stats.tui",
  async setup(context) {
    // Persisted, reactive refresh interval (ms). `storage.store` returns
    // `[state, setState]` where `state` is a reactive store (built-in panels
    // read it as `state.prop`); the second element is the async setter.
    const [settings, setSettings] = context.storage.store("system-stats", {
      initial: { refreshMs: 1000, theme: "amber" as ThemeName },
    })
    // Persisted theme name (falls back to the default if the stored record
    // predates the theme field, e.g. after the storage-key rename).
    const themeName = (): ThemeName => (settings.theme() as ThemeName | undefined) ?? "amber"
    const setTheme = (name: ThemeName) =>
      setSettings((draft) => {
        draft.theme = name
      })
    // Resolved palette — re-derives whenever the theme changes.
    const palette = () => THEMES[themeName()].p
    const refreshMs = () => {
      const ms = Number(settings.refreshMs)
      // Never hand `setInterval` a non-positive/NaN delay: `undefined` is
      // treated as ~1 ms and floods the RPC endpoint (~890 req/s observed).
      return Number.isFinite(ms) && ms > 0 ? ms : 1000
    }
    const setRefreshMs = (ms: number) =>
      setSettings((draft) => {
        draft.refreshMs = ms
      })

    // RPC subclient — read fresh `context.client` at call time (server may
    // restart), per RPC docs.
    const rpc = () => context.client.rpc(Stats)

    // RPC calls are location-scoped. Omitting `location` makes the server fall
    // back to its own working directory, which for the background service is
    // `$HOME` — where this project plugin is not registered. The call then
    // fails with `rpc.unavailable` (HTTP 400). Built-in TUI plugins use the
    // same `context.location ?? context.data.location.default()` idiom.
    //
    // `context.location` is reactive to the active session, so viewing a
    // session that belongs to another project would scope the call to a
    // location where this plugin is not registered. Capture the launch
    // location once and prefer it, falling back to the live one.
    const liveLocation = () =>
      context.location ?? context.data.location.default()
    const setupLocation = liveLocation()
    const candidateLocations = () => {
      const list = [setupLocation, liveLocation()].filter(
        (loc): loc is NonNullable<typeof loc> => loc != null,
      )
      const seen = new Set<string>()
      return list.filter((loc) => {
        const key = loc.directory
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    // Latest snapshot, re-rendered on every change.
    const [latest, setLatest] = createSignal<StatsSnapshot | null>(null)
    const [error, setError] = createSignal<string | null>(null)

    let timerId: ReturnType<typeof setInterval> | undefined
    let inFlight = false
    const tick = async () => {
      // nvidia-smi plus the short /proc/stat sampling can take longer than the
      // refresh interval; never let ticks pile up.
      if (inFlight) return
      inFlight = true
      try {
        // `stats` declares an empty-object input schema, so it is called with
        // `{}` (the runtime always encodes the argument against that schema).
        // The location travels in the second, non-contract argument.
        let result: StatsSnapshot | undefined
        let lastError: unknown
        for (const loc of candidateLocations()) {
          try {
            result = (await rpc().stats(
              {},
              { location: loc },
            )) as unknown as StatsSnapshot
            break
          } catch (err) {
            lastError = err
            // Only a location mismatch is worth the next candidate.
            const type =
              err && typeof err === "object" && "type" in err
                ? (err as { type: unknown }).type
                : undefined
            if (type !== "rpc.unavailable") throw err
          }
        }
        if (!result) throw lastError
        setLatest(result)
        setError(null)
      } catch (err) {
        // Surface the failure in the panel instead of swallowing it: this is
        // what distinguishes "no data yet" from "calls are failing".
        // RPC failures are thrown as plain `{ type, message, data? }` objects,
        // not `Error` instances.
        const message =
          err instanceof Error
            ? err.message
            : err && typeof err === "object" && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err)
        setError(message)
      } finally {
        inFlight = false
      }
    }

    // Restart the poll timer whenever refreshMs changes; clean up on dispose.
    createEffect(() => {
      const ms = refreshMs()
      if (timerId) {
        clearInterval(timerId)
        timerId = undefined
      }
      timerId = setInterval(() => void tick(), ms)
      onCleanup(() => {
        if (timerId) {
          clearInterval(timerId)
          timerId = undefined
        }
      })
    })

    void tick() // show a sample immediately on open

    // Command: choose the refresh rate via a dialog.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-system-stats.refresh",
          title: "Set stats refresh rate",
          palette: true,
          slash: { name: "system-stats-refresh" },
          run: () => {
            void applyRefreshRate(context, refreshMs, setRefreshMs)
          },
        },
      ],
    }))

    // Command: choose the theme palette via a dialog.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-system-stats.theme",
          title: "Set stats theme",
          palette: true,
          slash: { name: "system-stats-theme" },
          run: () => {
            void applyTheme(context, themeName, setTheme)
          },
        },
      ],
    }))

    // Command: toggle the panel open/closed.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-system-stats.toggle",
          title: "Toggle system stats",
          palette: true,
          slash: { name: "system-stats" },
          run: () => {
            const current = context.ui.panel.current()
            if (current && current.name === PANEL_ID) {
              context.ui.panel.close()
            } else {
              context.ui.panel.open(PANEL_ID)
            }
          },
        },
      ],
    }))

    // session.panel contribution. Only renders while this panel is selected.
    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL_ID}>
          <Panel
            width={panel.width}
            latest={latest}
            error={error}
            refreshMs={refreshMs}
            palette={palette}
            themeName={themeName}
          />
        </Show>
      ),
    })
  },
})

// The panel body. Kept as a component at module scope so it lives outside the
// plugin's setup closure; its reactive reads (`latest`/`refreshMs`) are passed
// in as accessors and read within JSX so Solid tracks them.
//
// Props are read through the props object (`props.latest()`), never
// destructured: destructuring reads once and silently freezes the panel.
function Panel(props: {
  width: number
  latest: () => StatsSnapshot | null
  error: () => string | null
  refreshMs: () => number
  palette: () => Palette
  themeName: () => ThemeName
}) {
  const context = usePlugin()
  const latest = props.latest
  const error = props.error
  const refreshMs = props.refreshMs
  const palette = props.palette
  const themeName = props.themeName

  // Inner padding per side and the bordered frame it adds to the width.
  const PADDING = 1 // was 2 — tighter panel
  const FRAME = 2 // left + right border
  const MIN_COLS = 32
  const MAX_COLS = 52

  // Force a re-render once per second so "updated Ns ago" keeps ticking even
  // between successful refreshes. Reads a plain, non-reactive local tick value
  // — registering `now()` below as the tracked dependency makes Solid re-run
  // the surrounding JSX render whenever this clock advances, independent of
  // whether `latest()` itself has changed.
  const [now, setNow] = createSignal(Date.now())
  const clock = setInterval(() => setNow(Date.now()), 1000)
  onCleanup(() => clearInterval(clock))
  const updatedLabel = () => {
    const snap = latest()
    if (!snap) return null
    const ageSec = Math.max(0, Math.floor((now() - snap.collectedAt) / 1000))
    return ageSec < 1 ? "только что" : `${ageSec}с назад`
  }

  // Color a numeric value by severity band. Falls back to muted when unavailable.
  const severity = (
    value: number | null,
    warn: number,
    crit: number,
  ): string | undefined => {
    if (value == null) return palette().muted
    if (value >= crit) return palette().crit
    if (value >= warn) return palette().warn
    return palette().base
  }

  // Width hugs the widest rendered line so the panel never wastes horizontal
  // space and still wraps gracefully on a tiny window. Each glyph is one cell
  // in the monospace renderer, so string length is a good proxy.
  const contentCols = (): number => {
    const snap = latest()
    if (!snap) return MIN_COLS
    const lines = [
      `GPU    ${snap.gpu.name ?? "N/A"}`,
      `  VRAM ${snap.gpu.usedMiB} / ${snap.gpu.totalMiB} MiB`,
      `  Util ${Math.round(snap.gpu.utilPct)}%`,
      `  Temp ${fmtTemp(snap.gpu.tempC)}`,
      `RAM    ${formatGB(snap.ram.usedBytes)} / ${formatGB(snap.ram.totalBytes)}`,
      `  Free ${formatGB(snap.ram.freeBytes)}`,
      `CPU    ${Math.round(snap.cpu.loadPct)}%`,
      `  Temp ${fmtTemp(snap.cpu.tempC)}`,
      `обновлено ${updatedLabel() ?? "—"} · refresh ${refreshMs()}ms`,
    ]
    return Math.max(MIN_COLS, ...lines.map((l) => l.length))
  }
  const cols = Math.min(
    MAX_COLS,
    Math.max(MIN_COLS, contentCols() + PADDING * 2 + FRAME),
  )

  return (
    <paletteCtx.Provider value={palette}>
        <Show
        // Compare to `null` (not pass the snapshot itself) so the tree is built
        // once and only its reactive attributes update on each refresh.
        when={latest() !== null}
        fallback={
          <box
            border
            borderStyle="double"
            padding={PADDING}
            borderColor={palette().border}
            backgroundColor={palette().bg}
          >
            <text fg={palette().muted}>Collecting stats…</text>
            <Show when={error()}>
              <text fg={palette().crit}>{error()}</text>
            </Show>
          </box>
        }
      >
        <box
          border
          borderStyle="double"
          padding={PADDING}
          width={cols}
          borderColor={palette().border}
          backgroundColor={palette().bg}
          title={THEMES[themeName()].label}
        >
          <box flexDirection="column" gap={0} marginY={1}>
            <StatRow label="GPU" value={latest()!.gpu.name ?? "N/A"} />
            <StatRow
              label="  VRAM"
              value={`${latest()!.gpu.usedMiB} / ${latest()!.gpu.totalMiB} MiB`}
            />
            <StatRow
              label="  Util"
              value={`${Math.round(latest()!.gpu.utilPct)}%`}
              accent={severity(latest()!.gpu.utilPct, 80, 95)}
            />
            <StatRow
              label="  Temp"
              value={fmtTemp(latest()!.gpu.tempC)}
              accent={severity(latest()!.gpu.tempC, 85, 95)}
            />
          </box>
  
          <box flexDirection="column" gap={0} marginY={1}>
            <StatRow
              label="RAM"
              value={`${formatGB(latest()!.ram.usedBytes)} / ${formatGB(
                latest()!.ram.totalBytes,
              )}`}
            />
            <StatRow label="  Free" value={formatGB(latest()!.ram.freeBytes)} />
          </box>
  
          <box flexDirection="column" gap={0} marginY={1}>
            <StatRow
              label="CPU"
              value={`${Math.round(latest()!.cpu.loadPct)}%`}
              accent={severity(latest()!.cpu.loadPct, 80, 95)}
            />
            <StatRow
              label="  Temp"
              value={fmtTemp(latest()!.cpu.tempC)}
              accent={severity(latest()!.cpu.tempC, 80, 95)}
            />
          </box>
  
          <text
            marginY={1}
            fg={palette().muted}
            font="dim"
            title="click to change refresh rate"
            onClick={() => void applyRefreshRate(context, refreshMs, setRefreshMs)}
          >
            <text fg={palette().accent}>● LIVE</text>{" "}·{" "}
            {updatedLabel() ? `обновлено ${updatedLabel()}` : "—"} · refresh{" "}
            {refreshMs()}ms
          </text>
        </box>
        </Show>
    </paletteCtx.Provider>
  )
}
