import {
  Show,
  createSignal,
  createEffect,
  createMemo,
  createContext,
  useContext,
  onCleanup,
} from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { Stats } from "./rpc.js";
import type { Stats as StatsSnapshot, CustomTheme } from "./rpc.js";
import { formatGB } from "./stats.js";

const PRESETS = [
  { value: 200, label: "200 ms" },
  { value: 500, label: "500 ms" },
  { value: 1000, label: "1000 ms" },
  { value: 2000, label: "2000 ms" },
  { value: 5000, label: "5000 ms" },
];

// Clamp an integer to an inclusive range. Used for the panel's free offsets
// (cells from the top-left corner) so a stored value can't place the panel
// off-screen or negative.
function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

// Retro 70s–90s early-computer phosphor palettes. Each theme is self-contained
// (no dependency on the host OS theme) so the "live terminal" look holds on
// dark or light hosts alike.
type ThemeName = "amber" | "green" | "mono";

interface Palette {
  bg: string;
  accent: string;
  base: string;
  muted: string;
  warn: string;
  crit: string;
  border: string;
}

// One entry in the merged theme map.
interface ThemeEntry {
  label: string;
  p: Palette;
}

// Built-in phosphor palettes. User themes are merged into the mutable `THEMES`
// below at setup(), so built-ins and custom share one code path (palette(),
// applyTheme(), the SettingsBody chips all read `THEMES`/`THEME_NAMES`).
const BUILTIN_THEMES: Record<ThemeName, ThemeEntry> = {
  amber: {
    label: "Amber CRT",
    p: {
      bg: "#1a1200",
      accent: "#ffb000",
      base: "#ffcc66",
      muted: "#b37a00",
      warn: "#ff9500",
      crit: "#ff5530",
      border: "#ffb000",
    },
  },
  green: {
    label: "Green Phosphor",
    p: {
      bg: "#001800",
      accent: "#33ff66",
      base: "#88ffaa",
      muted: "#1f9944",
      warn: "#aaff22",
      crit: "#ff3355",
      border: "#33ff66",
    },
  },
  mono: {
    label: "Mono IBM",
    p: {
      bg: "#0a0a0a",
      accent: "#ffffff",
      base: "#eeeeee",
      muted: "#8a8a8a",
      warn: "#ffff55",
      crit: "#ff5555",
      border: "#cccccc",
    },
  },
};

// Merged theme map: built-ins plus any user themes from SYSTEM_STATS_THEME_DIR.
// Seeded with the built-ins so the selector always has options even when no
// custom themes load (missing dir, RPC failure, empty list). Mutable at setup()
// — the custom set is only known then — but read lazily at interaction time, so
// the selector and chips see the final contents.
const THEMES: Record<string, ThemeEntry> = { ...BUILTIN_THEMES };

// Names of every available theme (built-ins + custom). Seeded to the built-ins;
// re-derived once after the setup() merge so user themes appear too.
let THEME_NAMES: string[] = Object.keys(BUILTIN_THEMES);

// User-settable scale presets for the panel width. OpenTUI renders glyphs at a
// fixed cell size (no font scaling), so "scale" resizes the panel's footprint
// in columns, not the text. Kept as plain data so the selector and the body
// share one source of truth.
const SCALE_OPTIONS = [
  { value: 80, label: "80%" },
  { value: 100, label: "100%" },
  { value: 125, label: "125%" },
  { value: 150, label: "150%" },
];

// The six anchor presets offered as quick one-click placements. The actual
// position is two free offsets (`posLeft`/`posTop` in cells from the top-left
// corner); these presets just set both offsets at once to a corner.
type Corner =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

const CORNER_LABELS: Record<Corner, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};
const CORNERS = Object.keys(CORNER_LABELS) as Corner[];
const CORNER_OPTIONS = CORNERS.map((name) => ({
  title: CORNER_LABELS[name],
  value: name,
}));

// Absolute props that pin the overlay wrapper at a free cell offset from the
// terminal's top-left corner. `posLeft`/`posTop` are the user-set offsets in
// cells; `cols`/`rows` are the panel's footprint so we can clamp it on-screen.
// The wrapper is positioned directly with a single `top` and a single `left`,
// so it occupies ONLY the panel's own bounding box (a full-width wrapper used
// to span the whole terminal and intercept clicks behind it — the "blocks
// interaction" bug). `bottom`/`right` are always returned too: @opentui/solid's
// `spread` only iterates the keys of the NEXT props object and never deletes
// disappeared keys, so a partial object would leave stale edges and pin the
// panel in the wrong place. Keys set to `undefined` are cleared by the setters.
function overlayProps(
  posLeft: number,
  posTop: number,
  cols: number,
  rows: number,
  terminalCols: number,
  terminalRows: number
) {
  const inset = 1;
  // Clamp so the panel never scrolls off-screen, even for a stored offset that
  // predates the current terminal size or a wider-than-panel value.
  const clampedLeft = clampInt(posLeft, 0, Math.max(0, terminalCols - cols));
  const clampedTop = clampInt(posTop, 0, Math.max(0, terminalRows - rows));
  return {
    position: "absolute" as const,
    zIndex: 2600,
    top: clampedTop,
    bottom: undefined,
    left: clampedLeft,
    right: undefined,
  };
}

// Options shared by the `/system-stats-refresh` command and by clicking the
// panel footer. Kept as a plain list so both call sites stay in sync.
const REFRESH_OPTIONS = PRESETS.map((p) => ({
  title: p.label,
  value: `${p.value}ms`,
}));

// Open the floating refresh-rate selector and apply the chosen interval.
// Shared by the palette command and the panel footer's `onClick`.
function applyRefreshRate(
  context: ReturnType<typeof usePlugin>,
  refreshMs: () => number,
  setRefreshMs: (ms: number) => void
) {
  return context.ui.dialog
    .select({
      title: "Stats refresh rate",
      current: `${refreshMs()}ms`,
      options: REFRESH_OPTIONS,
    })
    .then((chosen) => {
      if (chosen) {
        const ms = Number.parseInt(chosen.replace(/ms$/, ""), 10);
        if (!Number.isNaN(ms) && ms > 0) setRefreshMs(ms);
      }
    });
}

// Open the theme selector dialog and persist the chosen palette.
// Shared by the palette command and the panel footer's theme switch.
function applyTheme(
  context: ReturnType<typeof usePlugin>,
  themeName: () => string,
  setTheme: (name: string) => void
) {
  return context.ui.dialog
    .select({
      title: "System stats theme",
      // `current` must match an option `value` (not its title) to highlight.
      current: themeName(),
      options: THEME_NAMES.map((name) => ({
        title: THEMES[name]?.label ?? name,
        value: name,
      })),
    })
    .then((chosen) => {
      if (chosen) {
        const next = chosen as string;
        if (THEMES[next]) setTheme(next);
      }
    });
}

// Open the position selector and persist the chosen anchor via a corner preset.
// Needs the terminal size and the panel's footprint to resolve the opposite
// edge for right/bottom anchors, so it takes them as arguments. Returns the
// new posLeft/posTop so callers can persist them.
function cornerOffsets(
  corner: Corner,
  cols: number,
  rows: number,
  terminalCols: number,
  terminalRows: number
): { posLeft: number; posTop: number } {
  const inset = 1;
  switch (corner) {
    case "top-left":
      return { posLeft: inset, posTop: inset };
    case "top-right":
      return { posLeft: terminalCols - cols - inset, posTop: inset };
    case "top-center":
      return {
        posLeft: Math.max(inset, Math.floor((terminalCols - cols) / 2)),
        posTop: inset,
      };
    case "bottom-left":
      return { posLeft: inset, posTop: terminalRows - rows - inset };
    case "bottom-center":
      return {
        posLeft: Math.max(inset, Math.floor((terminalCols - cols) / 2)),
        posTop: terminalRows - rows - inset,
      };
    default:
      return { posLeft: terminalCols - cols - inset, posTop: terminalRows - rows - inset };
  }
}

function fmtTemp(c: number | null): string {
  return c == null ? "—" : `${Math.round(c)}°C`;
}

// A single labeled stat row: label (muted) | value (right aligned).
// Colors come from the active phosphor `palette` (provided by the parent
// `Panel` via context), so the retro look is identical on dark and light hosts.
function StatRow(props: { label: string; value: string; accent?: string }) {
  const palette = useContext(paletteCtx);
  return (
    <box flexDirection="row" alignItems="center" justifyContent="space-between">
      <text fg={palette().muted}>{props.label}</text>
      <text fg={props.accent ?? palette().base}>{props.value}</text>
    </box>
  );
}

// Palette provided to the panel body so `StatRow` can stay presentational.
const paletteCtx = createContext<() => Palette>();

export default Plugin.define({
  id: "opencode-system-stats.tui",
  async setup(context) {
    // Persisted, reactive refresh interval (ms). `storage.store` returns
    // `[state, setState]` where `state` is a reactive store (built-in panels
    // read it as `state.prop`); the second element is the async setter.
    const [settings, setSettings] = context.storage.store("system-stats", {
      initial: {
        refreshMs: 1000,
        theme: "amber" as string,
        posLeft: 1 as number,
        posTop: 1 as number,
        scale: 100 as number,
      },
    });
    // Persisted theme name. `settings` is a reactive Solid store, so `theme` is
    // read as a property (`settings.theme`), never called — calling it threw
    // "settings.theme is not a function" and the plugin crashed in its slot.
    // Falls back to the default if the stored record predates the theme field.
    const themeName = (): string =>
      (settings.theme as string | undefined) ?? "amber";
    const setTheme = (name: string) =>
      setSettings((draft) => {
        draft.theme = name;
      });
    // Persisted overlay offset from the top-left corner, in cells. Two numbers
    // replace the old single `Position` anchor: they give free placement
    // anywhere; the six corner presets in SettingsBody just set both at once.
    // Falls back to the inset corner if the stored record predates them.
    const posLeft = (): number => (settings.posLeft as number | undefined) ?? 1;
    const posTop = (): number => (settings.posTop as number | undefined) ?? 1;
    const setPosLeft = (v: number) =>
      setSettings((draft) => {
        draft.posLeft = clampInt(v, 0, Number.MAX_SAFE_INTEGER);
      });
    const setPosTop = (v: number) =>
      setSettings((draft) => {
        draft.posTop = clampInt(v, 0, Number.MAX_SAFE_INTEGER);
      });
    // Persisted panel width scale, as a percent of the natural width. Read as a
    // property (reactive store); falls back to 100% for older records.
    const scale = (): number => (settings.scale as number | undefined) ?? 100;
    const setScale = (v: number) =>
      setSettings((draft) => {
        draft.scale = clampInt(v, 50, 200);
      });
    // Whether the floating overlay is visible. Ephemeral (not persisted): the
    // panel is opened on demand via /system-stats, like the DebugOverlay.
    const [visible, setVisible] = createSignal(false);
    // Live panel footprint (cols×rows in cells), reported by the rendered Panel.
    // The settings dialog reads it to resolve the opposite edge for the
    // right/centre/bottom corner presets — those offsets depend on the panel's
    // width/height against the terminal size. Defaults cover the brief window
    // before the first render.
    const [panelMetrics, setPanelMetrics] = createSignal<{
      cols: number;
      rows: number;
    }>({ cols: 40, rows: 20 });
    // Resolved palette — re-derives whenever the theme changes. Falls back to a
    // built-in if a stored/custom name somehow isn't in the map.
    const palette = () => THEMES[themeName()]?.p ?? BUILTIN_THEMES.amber.p;
    const refreshMs = () => {
      const ms = Number(settings.refreshMs);
      // Never hand `setInterval` a non-positive/NaN delay: `undefined` is
      // treated as ~1 ms and floods the RPC endpoint (~890 req/s observed).
      return Number.isFinite(ms) && ms > 0 ? ms : 1000;
    };
    const setRefreshMs = (ms: number) =>
      setSettings((draft) => {
        draft.refreshMs = ms;
      });

    // RPC subclient — read fresh `context.client` at call time (server may
    // restart), per RPC docs.
    const rpc = () => context.client.rpc(Stats);

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
      context.location ?? context.data.location.default();
    const setupLocation = liveLocation();

    // Load user custom themes from SYSTEM_STATS_THEME_DIR via the server half.
    // Called ONCE here (not in the tick loop): the set is stable for the
    // session and only needed to populate the selector. RPC is location-scoped,
    // so the location travels in the second arg, like `stats()`. A location
    // mismatch or RPC failure is non-fatal — fall back to built-ins. Invalid
    // themes were already filtered + warned on the server side.
    try {
      const loaded = (await rpc().themes(
        {},
        { location: setupLocation },
      )) as unknown as { themes?: CustomTheme[] };
      if (loaded.themes) {
        for (const t of loaded.themes) {
          if (t && t.name && t.palette) {
            THEMES[t.name] = {
              label: t.label ?? t.name,
              p: t.palette,
            };
          } else {
            console.warn(
              "[system-stats] ignoring malformed custom theme from server:",
              t,
            );
          }
        }
        THEME_NAMES = Object.keys(THEMES);
      }
    } catch (err) {
      console.warn(
        "[system-stats] could not load custom themes, using built-ins:",
        err,
      );
    }

    const candidateLocations = () => {
      const list = [setupLocation, liveLocation()].filter(
        (loc): loc is NonNullable<typeof loc> => loc != null
      );
      const seen = new Set<string>();
      return list.filter((loc) => {
        const key = loc.directory;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    // Latest snapshot, re-rendered on every change.
    const [latest, setLatest] = createSignal<StatsSnapshot | null>(null);
    const [error, setError] = createSignal<string | null>(null);

    let timerId: ReturnType<typeof setInterval> | undefined;
    let inFlight = false;
    const tick = async () => {
      // nvidia-smi plus the short /proc/stat sampling can take longer than the
      // refresh interval; never let ticks pile up.
      if (inFlight) return;
      inFlight = true;
      try {
        // `stats` declares an empty-object input schema, so it is called with
        // `{}` (the runtime always encodes the argument against that schema).
        // The location travels in the second, non-contract argument.
        let result: StatsSnapshot | undefined;
        let lastError: unknown;
        for (const loc of candidateLocations()) {
          try {
            result = (await rpc().stats(
              {},
              { location: loc }
            )) as unknown as StatsSnapshot;
            break;
          } catch (err) {
            lastError = err;
            // Only a location mismatch is worth the next candidate.
            const type =
              err && typeof err === "object" && "type" in err
                ? (err as { type: unknown }).type
                : undefined;
            if (type !== "rpc.unavailable") throw err;
          }
        }
        if (!result) throw lastError;
        setLatest(result);
        setError(null);
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
              : String(err);
        setError(message);
      } finally {
        inFlight = false;
      }
    };

    // Poll only while the overlay is visible: the panel is opened on demand, so
    // there is no reason to hammer nvidia-smi (and the RPC) while it is hidden.
    // Restart the timer whenever refreshMs or visibility changes; clean up on
    // dispose.
    createEffect(() => {
      const ms = refreshMs();
      const shown = visible();
      if (timerId) {
        clearInterval(timerId);
        timerId = undefined;
      }
      if (!shown) return;
      void tick(); // paint a sample immediately on open
      timerId = setInterval(() => void tick(), ms);
      onCleanup(() => {
        if (timerId) {
          clearInterval(timerId);
          timerId = undefined;
        }
      });
    });

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
            void applyRefreshRate(context, refreshMs, setRefreshMs);
          },
        },
      ],
    }));

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
            void applyTheme(context, themeName, setTheme);
          },
        },
      ],
    }));

    // Command: open the unified settings dialog (position, size, theme,
    // refresh rate). Position/size need the live panel footprint + terminal
    // size, which only exist inside the dialog, so the dialog is the single
    // place to edit them.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-system-stats.position",
          title: "Set stats position",
          palette: true,
          slash: { name: "system-stats-position" },
          run: () => {
            void openSettings();
          },
        },
      ],
    }));

    // Command: toggle the floating overlay open/closed.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-system-stats.toggle",
          title: "Toggle system stats",
          palette: true,
          slash: { name: "system-stats" },
          run: () => {
            setVisible((v) => !v);
          },
        },
      ],
    }));

    // Unified settings dialog: refresh rate, theme and position live in ONE
    // window that opens on click of the stats panel (see `Panel`). `dialog.show`
    // renders a custom JSX dialog; `dialog.set` sizes/centers it. Escape or a
    // click outside (or the close button) closes it via `dialog.clear`.
    const openSettings = () => {
      context.ui.dialog.set({ size: "medium", centered: true });
      context.ui.dialog.show(() => (
        <paletteCtx.Provider value={palette}>
          <SettingsBody
            themeName={themeName}
            setTheme={setTheme}
            scale={scale}
            setScale={setScale}
            metrics={panelMetrics}
            posLeft={posLeft}
            setPosLeft={setPosLeft}
            posTop={posTop}
            setPosTop={setPosTop}
            refreshMs={refreshMs}
            setRefreshMs={setRefreshMs}
          />
        </paletteCtx.Provider>
      ));
    };

    // Floating overlay: appended to the root `app` slot so it can sit anywhere
    // on screen — unlike session.panel, which the host docks or fullscreens.
    // `Panel` renders an absolutely-positioned wrapper via `anchorProps`.
    context.ui.slot({
      append: "app",
      // The slot renderer is wrapped in a try/catch so an unexpected value that
      // somehow reaches a `<text>` (Solid throws
      // "TextNodeRenderable only accepts strings…") is surfaced as a readable
      // line inside the panel instead of aborting the whole `app` slot with a
      // modal crash toast. The panel is already string-safe; this is a safety
      // net that also turns a future crash into a debugging clue.
      render: () => {
        try {
          return (
            <Show when={visible()}>
              <Panel
                latest={latest}
                error={error}
                refreshMs={refreshMs}
                setRefreshMs={setRefreshMs}
                palette={palette}
                themeName={themeName}
                scale={scale}
                setScale={setScale}
                metrics={panelMetrics}
                setMetrics={setPanelMetrics}
                posLeft={posLeft}
                posTop={posTop}
                openSettings={openSettings}
              />
            </Show>
          );
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : err && typeof err === "object" && "message" in err
                ? String((err as { message: unknown }).message)
                : String(err);
          return <text fg="#ff5555">Stats panel error: {message}</text>;
        }
      },
    });
  },
});

// The panel body. Kept as a component at module scope so it lives outside the
// plugin's setup closure; its reactive reads (`latest`/`refreshMs`) are passed
// in as accessors and read within JSX so Solid tracks them.
//
// Props are read through the props object (`props.latest()`), never
// destructured: destructuring reads once and silently freezes the panel.
function Panel(props: {
  latest: () => StatsSnapshot | null;
  error: () => string | null;
  refreshMs: () => number;
  setRefreshMs: (ms: number) => void;
  palette: () => Palette;
  themeName: () => string;
  scale: () => number;
  setScale: (v: number) => void;
  metrics: () => { cols: number; rows: number };
  setMetrics: (m: { cols: number; rows: number }) => void;
  posLeft: () => number;
  posTop: () => number;
  openSettings: () => void;
}) {
  const context = usePlugin();
  // One resize subscription for the whole panel. `useTerminalDimensions` returns
  // an accessor (`() => {width,height}`), not the dimensions themselves.
  const terminal = useTerminalDimensions();
  const latest = props.latest;
  const error = props.error;
  const refreshMs = props.refreshMs;
  const setRefreshMs = props.setRefreshMs;
  const palette = props.palette;
  const themeName = props.themeName;
  const scale = props.scale;
  const metrics = props.metrics;
  // `setScale`/`setMetrics` are stable setter functions (not reactive
  // accessors), so destructuring them is safe — same as `setRefreshMs` above.
  const setScale = props.setScale;
  const setMetrics = props.setMetrics;
  // `openSettings` is a stable function (created once in setup), so it is safe
  // to destructure here like the other setters above.
  const openSettings = props.openSettings;
  // Position is read (not set) here; setters live in the dialog.
  const posLeft = props.posLeft;
  const posTop = props.posTop;

  // Helper to safely get nested properties with fallbacks
  const safeGet = (obj: any, path: string, fallback: any = "—") => {
    try {
      return path
        .split(".")
        .reduce((current, key) => current?.[key] ?? fallback, obj);
    } catch {
      return fallback;
    }
  };

  // Helper to safely get nested properties with null fallback
  const safeGetNull = (obj: any, path: string) => {
    try {
      return path.split(".").reduce((current, key) => current?.[key], obj);
    } catch {
      return null;
    }
  };

  // Inner padding per side and the bordered frame it adds to the width.
  const PADDING = 1; // was 2 — tighter panel
  const FRAME = 2; // left + right border
  // Natural (unscaled) width is clamped to this base range so scale=100%
  // renders exactly as before. `scale` then multiplies it and the outer clamp
  // lets the footprint drift a little beyond the base range (24–64 cols).
  const BASE_MIN_COLS = 32;
  const BASE_MAX_COLS = 52;
  const MIN_COLS = 24;
  const MAX_COLS = 64;

  // Approximate panel height in rows. Values never wrap (the width always fits
  // the widest line), so the row count is fixed; this is only used to keep
  // bottom-anchored placements on-screen.
  const PANEL_ROWS = 20;

  // Force a re-render once per second so "updated Ns ago" keeps ticking even
  // between successful refreshes. Reads a plain, non-reactive local tick value
  // — registering `now()` below as the tracked dependency makes Solid re-run
  // the surrounding JSX render whenever this clock advances, independent of
  // whether `latest()` itself has changed.
  const [now, setNow] = createSignal(Date.now());
  const clock = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(clock));
  const updatedLabel = () => {
    const snap = latest();
    if (!snap) return null;
    const ageSec = Math.max(0, Math.floor((now() - snap.collectedAt) / 1000));
    // Drop the ambiguous "только что" wording; show relative time only once
    // at least a second has passed (the "● LIVE" dot already conveys freshness).
    // Keep it short (`5s`, not `obnovleno 5s nazad`) so the footer never wraps
    // in the panel's narrow content column.
    return ageSec < 1 ? null : `${ageSec}s`;
  };

  // Color a numeric value by severity band. Falls back to muted when unavailable.
  const severity = (
    value: number | null,
    warn: number,
    crit: number
  ): string | undefined => {
    if (value == null) return palette().muted;
    if (value >= crit) return palette().crit;
    if (value >= warn) return palette().warn;
    return palette().base;
  };

  // Safely convert any value to string, handling null/undefined properly
  const safeString = (value: unknown): string => {
    if (value === null || value === undefined) return "—";
    return String(value);
  };

  // Width hugs the widest rendered line so the panel never wastes horizontal
  // space and still wraps gracefully on a tiny window. Each glyph is one cell
  // in the monospace renderer, so string length is a good proxy.
  const contentCols = (): number => {
    const snap = latest();
    if (!snap) return BASE_MIN_COLS;
    const lines = [
      `GPU    ${safeString(snap.gpu?.name)}`,
      `  VRAM ${safeString(snap.gpu?.usedMiB)} / ${safeString(snap.gpu?.totalMiB)} MiB`,
      `  Util ${Math.round(snap.gpu?.utilPct ?? 0)}%`,
      `  Temp ${fmtTemp(snap.gpu?.tempC)}`,
      `RAM    ${formatGB(snap.ram?.usedBytes)} / ${formatGB(snap.ram?.totalBytes)}`,
      `  Free ${formatGB(snap.ram?.freeBytes)}`,
      `CPU    ${Math.round(snap.cpu?.loadPct ?? 0)}%`,
      `  Temp ${fmtTemp(snap.cpu?.tempC)}`,
    ];
    return Math.max(BASE_MIN_COLS, ...lines.map((l) => l.length));
  };
  // Natural width clamped to the base range, then scaled. `scale` is a percent
  // of the natural width — the only real "zoom" available (OpenTUI renders
  // glyphs at a fixed cell size), so it resizes the panel's footprint, not the
  // text. The outer clamp keeps even a large scale from going off-screen.
  //
  // Both are memos, not plain consts: a Solid component body runs ONCE, so a
  // `const cols = …scale()…` would freeze at the first render and `width={cols}`
  // would never change when the user picks another scale. Reading `cols()` in
  // the JSX/effect keeps `scale` (and the content width) tracked.
  const unscaledCols = createMemo(() =>
    Math.min(
      BASE_MAX_COLS,
      Math.max(BASE_MIN_COLS, contentCols() + PADDING * 2 + FRAME)
    )
  );
  const cols = createMemo(() =>
    clampInt(
      Math.round(unscaledCols() * scale() / 100),
      MIN_COLS,
      MAX_COLS
    )
  );

  // Report the live footprint so the settings dialog can resolve the opposite
  // edge for the right/centre/bottom corner presets.
  createEffect(() => {
    setMetrics({ cols: cols(), rows: PANEL_ROWS });
  });

  return (
    <paletteCtx.Provider value={palette}>
      {/* Floating overlay at the user-set free offset: the wrapper is absolute
          inside the app slot's flexGrow area and sits `posLeft`/`posTop` cells
          from the top-left corner, clamped on-screen by `overlayProps`. */}
      <box
        {...overlayProps(
          posLeft(),
          posTop(),
          cols(),
          PANEL_ROWS,
          terminal().width,
          terminal().height
        )}
      >
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
            width={cols()}
            borderColor={palette().border}
            backgroundColor={palette().bg}
            title={" " + safeString(THEMES[themeName()]?.label + " ")}
            onMouseUp={() => void openSettings()}
          >
            <box flexDirection="column" gap={0} marginY={1}>
              <StatRow
                label="GPU"
                value={safeString(safeGet(latest(), "gpu.name"))}
              />
              <StatRow
                label="  VRAM"
                value={`${safeString(safeGet(latest(), "gpu.usedMiB"))} / ${safeString(safeGet(latest(), "gpu.totalMiB"))} MiB`}
              />
              <StatRow
                label="  Util"
                value={`${Math.round(safeGet(latest(), "gpu.utilPct", 0))}%`}
                accent={severity(safeGetNull(latest(), "gpu.utilPct"), 80, 95)}
              />
              <StatRow
                label="  Temp"
                value={fmtTemp(safeGetNull(latest(), "gpu.tempC"))}
                accent={severity(safeGetNull(latest(), "gpu.tempC"), 85, 95)}
              />
            </box>

            <box flexDirection="column" gap={0} marginY={1}>
              <StatRow
                label="RAM"
                value={`${formatGB(safeGet(latest(), "ram.usedBytes"))} / ${formatGB(
                  safeGet(latest(), "ram.totalBytes")
                )}`}
              />
              <StatRow
                label="  Free"
                value={formatGB(safeGet(latest(), "ram.freeBytes"))}
              />
            </box>

            <box flexDirection="column" gap={0} marginY={1}>
              <StatRow
                label="CPU"
                value={`${Math.round(safeGet(latest(), "cpu.loadPct", 0))}%`}
                accent={severity(safeGetNull(latest(), "cpu.loadPct"), 80, 95)}
              />
              <StatRow
                label="  Temp"
                value={fmtTemp(safeGetNull(latest(), "cpu.tempC"))}
                accent={severity(safeGetNull(latest(), "cpu.tempC"), 80, 95)}
              />
            </box>
            <box
              marginY={1}
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              onMouseUp={() => void openSettings()}
            >
              {/* Live dot — visually separated from the update/refresh text. */}
              <box
                onMouseUp={() => void openSettings()}
              >
                <text fg={palette().accent} attributes={TextAttributes.BOLD}>● LIVE</text>
              </box>
              {/* Relative update time (once at least a second old) + refresh
                  rate. No placeholder dash/dot when the age is unknown: that
                  stray "— ·" used to wrap right after "● LIVE" and look like
                  part of the badge. */}
              <text fg={palette().muted} attributes={TextAttributes.DIM}>
                {updatedLabel() ? `${updatedLabel()} · ` : ""}refresh {safeString(refreshMs())}ms
              </text>
            </box>
          </box>
        </Show>
      </box>
    </paletteCtx.Provider>
  );
}

// A single clickable option chip inside the unified settings dialog. The
// current value is an inverted accent bar with a ▸ mark and bold text; the other
// options are transparent with muted text. Clicking applies the value through
// `onSelect`. The active palette is read from `paletteCtx` (set by the dialog's
// provider) so the highlight matches the panel's own look.
function Option(props: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  const palette = useContext(paletteCtx);
  return (
    <box
      width={26}
      paddingX={1}
      backgroundColor={props.active ? palette().accent : undefined}
      onMouseUp={props.onSelect}
    >
      <text
        fg={props.active ? palette().bg : palette().muted}
        attributes={props.active ? TextAttributes.BOLD : undefined}
      >
        {(props.active ? "▸ " : "  ") + props.label}
      </text>
    </box>
  );
}

// A tiny [-] N [+] stepper for the panel's free offsets (cells from the top-left
// corner). The label names the axis; the centre value is a plain read-only
// field; [-]/[+] nudge it by one cell. Reports each change via `onChange`.
function Stepper(props: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const palette = useContext(paletteCtx);
  return (
    <box flexDirection="row" alignItems="center" columnGap={0}>
      <text fg={palette().muted} marginTop={0}>
        {props.label}
      </text>
      <box
        onMouseUp={() => props.onChange(props.value - 1)}
        paddingX={1}
        marginLeft={1}
      >
        <text fg={palette().base}>-</text>
      </box>
      <box width={4} textAlign="center" marginLeft={1}>
        <text fg={palette().base}>{props.value}</text>
      </box>
      <box
        onMouseUp={() => props.onChange(props.value + 1)}
        paddingX={1}
        marginLeft={1}
      >
        <text fg={palette().base}>+</text>
      </box>
    </box>
  );
}

// The unified settings dialog body: refresh rate, theme and position are all
// edited in ONE window, replacing the three separate `/system-stats-*`
// commands. Each option is a compact one-line chip (two per row); the current
// value is highlighted with an inverted accent bar and a ▸ mark. State is read
// from the live accessors passed in (the same reactive store the panel reads),
// so a change here applies to the panel immediately. `usePlugin` gives the close
// button access to `dialog.clear`.
function SettingsBody(props: {
  themeName: () => string;
  setTheme: (name: string) => void;
  scale: () => number;
  setScale: (v: number) => void;
  metrics: () => { cols: number; rows: number };
  posLeft: () => number;
  setPosLeft: (v: number) => void;
  posTop: () => number;
  setPosTop: (v: number) => void;
  refreshMs: () => number;
  setRefreshMs: (ms: number) => void;
}) {
  const context = usePlugin();
  const palette = useContext(paletteCtx);
  // Terminal size in columns/rows — needed to resolve the opposite edge for
  // the right/centre/bottom corner presets against the live panel footprint.
  const terminal = useTerminalDimensions();
  const close = () => {
    context.ui.dialog.clear();
  };

  // Which corner the current offsets sit nearest to, so that chip can be
  // highlighted. The offsets are the source of truth; this is just a display
  // hint derived from them.
  const currentCorner = (): Corner => {
    const { cols, rows } = props.metrics();
    const { width, height } = terminal();
    const offX = props.posLeft();
    const offY = props.posTop();
    const nearTop = offY <= 3;
    const nearBottom = offY >= Math.max(0, height - rows - 3);
    const nearLeft = offX <= 3;
    const nearRight = offX >= width - cols - 3;
    if (nearTop) return nearLeft ? "top-left" : nearRight ? "top-right" : "top-center";
    if (nearBottom)
      return nearLeft ? "bottom-left" : nearRight ? "bottom-right" : "bottom-center";
    // Between top and bottom: decide by horizontal side only.
    return nearLeft ? "top-left" : nearRight ? "top-right" : "top-center";
  };

  return (
    // `width="100%"` fills the host dialog surface (60 cols for "medium"),
    // which otherwise shows as a grey frame around a narrower (50-col) body.
    // The host also prepends one blank row (`paddingTop={1}`); the negative
    // margin pulls this box up so the theme background covers it too.
    <box
      border
      borderStyle="single"
      paddingX={2}
      paddingY={1}
      width="100%"
      marginTop={-1}
      backgroundColor={palette().bg}
      borderColor={palette().border}
      flexDirection="column"
      gap={1}
    >
      {/* Title row + a close button. Escape / click-outside also close it. */}
      <box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingX={1}
      >
        <text fg={palette().accent} attributes={TextAttributes.BOLD}>◈ Stats settings</text>
        <box onMouseUp={close} paddingX={1}>
          <text fg={palette().muted}>×</text>
        </box>
      </box>

      {/* Refresh rate — click a preset to apply it. */}
      <box flexDirection="column" gap={0}>
        <text fg={palette().base} attributes={TextAttributes.BOLD}>Refresh rate</text>
        <box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0}>
          {PRESETS.map((p) => (
            <Option
              label={p.label}
              active={p.value === props.refreshMs()}
              onSelect={() => props.setRefreshMs(p.value)}
            />
          ))}
        </box>
      </box>

      {/* Theme — click a palette to apply it. */}
      <box flexDirection="column" gap={0}>
        <text fg={palette().base} attributes={TextAttributes.BOLD}>Theme</text>
        <box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0}>
          {THEME_NAMES.map((name) => (
            <Option
              label={THEMES[name]?.label ?? name}
              active={name === props.themeName()}
              onSelect={() => props.setTheme(name)}
            />
          ))}
        </box>
      </box>

      {/* Size — panel width as a percentage of its natural width. OpenTUI
           renders glyphs at a fixed cell size, so this resizes the panel's
           footprint in columns, not the text. */}
      <box flexDirection="column" gap={0}>
        <text fg={palette().base} attributes={TextAttributes.BOLD}>Size</text>
        <box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0}>
          {SCALE_OPTIONS.map((s) => (
            <Option
              label={s.label}
              active={s.value === props.scale()}
              onSelect={() => props.setScale(s.value)}
            />
          ))}
        </box>
      </box>

      {/* Position — free placement. The six chips are quick corner presets
           (they set both offsets at once); the steppers set the exact cell
           offset from the top-left corner. The offsets are clamped on-screen
           when the panel renders. */}
      <box flexDirection="column" gap={0}>
        <text fg={palette().base} attributes={TextAttributes.BOLD}>Position</text>
        <box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={0}>
          {CORNERS.map((c) => (
            <Option
              label={CORNER_LABELS[c]}
              active={c === currentCorner()}
              onSelect={() => {
                const { cols, rows } = props.metrics();
                const { width, height } = terminal();
                const off = cornerOffsets(c, cols, rows, width, height);
                props.setPosLeft(off.posLeft);
                props.setPosTop(off.posTop);
              }}
            />
          ))}
        </box>
        <box flexDirection="column" gap={0} marginTop={1}>
          <text fg={palette().base} attributes={TextAttributes.BOLD}>Custom position</text>
          <box
            flexDirection="row"
            flexWrap="wrap"
            columnGap={1}
            rowGap={0}
          >
            <Stepper
              label="Left"
              value={props.posLeft()}
              onChange={props.setPosLeft}
            />
            <Stepper
              label="Top"
              value={props.posTop()}
              onChange={props.setPosTop}
            />
          </box>
        </box>
      </box>
    </box>
  );
}
