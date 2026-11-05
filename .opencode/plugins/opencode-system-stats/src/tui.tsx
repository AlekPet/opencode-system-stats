import {
  Show,
  createSignal,
  createEffect,
  createContext,
  useContext,
  onCleanup,
} from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { Stats } from "./rpc.js";
import type { Stats as StatsSnapshot } from "./rpc.js";
import { formatGB } from "./stats.js";

const PRESETS = [
  { value: 200, label: "200 ms — fastest" },
  { value: 500, label: "500 ms — smooth" },
  { value: 1000, label: "1000 ms — default" },
  { value: 2000, label: "2000 ms — light" },
  { value: 5000, label: "5000 ms — background" },
];

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

const THEMES: Record<ThemeName, { label: string; p: Palette }> = {
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
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

// Where the floating overlay sits on screen. The `app` slot mounts inside a
// flexGrow column, so an absolutely-positioned wrapper spans the main area and
// aligns the panel to one of six anchors (corners or top/bottom centre).
type Position =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

const POSITION_LABELS: Record<Position, string> = {
  "top-left": "Top left",
  "top-center": "Top center",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-center": "Bottom center",
  "bottom-right": "Bottom right",
};
const POSITION_NAMES = Object.keys(POSITION_LABELS) as Position[];
const POSITION_OPTIONS = POSITION_NAMES.map((name) => ({
  title: POSITION_LABELS[name],
  value: name,
}));

// Absolute props that pin the overlay wrapper to one of the six anchors. The
// wrapper is positioned directly with a single top/bottom and a single
// left/right, so it occupies ONLY the panel's own bounding box. The previous
// full-width wrapper (`left:0; right:0`) spanned the entire terminal width and
// intercepted clicks on everything behind and beside the panel — that is the
// "blocks interaction" bug. For the centre anchors the left offset is derived
// from the terminal width (cells) via `useTerminalDimensions`, so the panel
// stays centred without a full-width box.
function overlayProps(position: Position, cols: number) {
  const inset = 1;
  const width = useTerminalDimensions().width;
  const centerX = Math.max(inset, Math.floor((width - cols) / 2));
  if (position === "top-left")
    return { position: "absolute" as const, zIndex: 2600, top: inset, left: inset };
  if (position === "top-right")
    return { position: "absolute" as const, zIndex: 2600, top: inset, right: inset };
  if (position === "top-center")
    return { position: "absolute" as const, zIndex: 2600, top: inset, left: centerX };
  if (position === "bottom-left")
    return { position: "absolute" as const, zIndex: 2600, bottom: inset, left: inset };
  if (position === "bottom-center")
    return { position: "absolute" as const, zIndex: 2600, bottom: inset, left: centerX };
  return { position: "absolute" as const, zIndex: 2600, bottom: inset, right: inset };
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
  themeName: () => ThemeName,
  setTheme: (name: ThemeName) => void
) {
  return context.ui.dialog
    .select({
      title: "System stats theme",
      // `current` must match an option `value` (not its title) to highlight.
      current: themeName(),
      options: THEME_NAMES.map((name) => ({
        title: THEMES[name].label,
        value: name,
      })),
    })
    .then((chosen) => {
      if (chosen) {
        const next = chosen as ThemeName;
        if (THEMES[next]) setTheme(next);
      }
    });
}

// Open the position selector and persist the chosen anchor.
function applyPosition(
  context: ReturnType<typeof usePlugin>,
  position: () => Position,
  setPosition: (p: Position) => void
) {
  return context.ui.dialog
    .select({
      title: "Stats position",
      current: position(),
      options: POSITION_OPTIONS,
    })
    .then((chosen) => {
      if (chosen && POSITION_LABELS[chosen as Position])
        setPosition(chosen as Position);
    });
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
        theme: "amber" as ThemeName,
        position: "top-right" as Position,
      },
    });
    // Persisted theme name. `settings` is a reactive Solid store, so `theme` is
    // read as a property (`settings.theme`), never called — calling it threw
    // "settings.theme is not a function" and the plugin crashed in its slot.
    // Falls back to the default if the stored record predates the theme field.
    const themeName = (): ThemeName =>
      (settings.theme as ThemeName | undefined) ?? "amber";
    const setTheme = (name: ThemeName) =>
      setSettings((draft) => {
        draft.theme = name;
      });
    // Persisted overlay anchor (falls back if the stored record predates it).
    const position = (): Position =>
      (settings.position as Position | undefined) ?? "top-right";
    const setPosition = (p: Position) =>
      setSettings((draft) => {
        draft.position = p;
      });
    // Whether the floating overlay is visible. Ephemeral (not persisted): the
    // panel is opened on demand via /system-stats, like the DebugOverlay.
    const [visible, setVisible] = createSignal(false);
    // Resolved palette — re-derives whenever the theme changes.
    const palette = () => THEMES[themeName()].p;
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

    // Command: choose the overlay anchor (corner / top-bottom centre).
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-system-stats.position",
          title: "Set stats position",
          palette: true,
          slash: { name: "system-stats-position" },
          run: () => {
            void applyPosition(context, position, setPosition);
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
            position={position}
            setPosition={setPosition}
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
                position={position}
                setTheme={setTheme}
                setPosition={setPosition}
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
  themeName: () => ThemeName;
  position: () => Position;
  setTheme: (name: ThemeName) => void;
  setPosition: (p: Position) => void;
  openSettings: () => void;
}) {
  const context = usePlugin();
  const latest = props.latest;
  const error = props.error;
  const refreshMs = props.refreshMs;
  const setRefreshMs = props.setRefreshMs;
  const palette = props.palette;
  const themeName = props.themeName;
  const position = props.position;
  // `setTheme`/`setPosition` are stable setter functions (not reactive
  // accessors), so destructuring them is safe — same as `setRefreshMs` above.
  const setTheme = props.setTheme;
  const setPosition = props.setPosition;
  // `openSettings` is a stable function (created once in setup), so it is safe
  // to destructure here like the other setters above.
  const openSettings = props.openSettings;

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
  const MIN_COLS = 32;
  const MAX_COLS = 52;

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
    return ageSec < 1 ? null : `${ageSec}с назад`;
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
    if (!snap) return MIN_COLS;
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
    return Math.max(MIN_COLS, ...lines.map((l) => l.length));
  };
  const cols = Math.min(
    MAX_COLS,
    Math.max(MIN_COLS, contentCols() + PADDING * 2 + FRAME)
  );

  return (
    <paletteCtx.Provider value={palette}>
      {/* Floating overlay anchored by `position`: the wrapper is absolute
          inside the app slot's flexGrow area and aligns the fixed-width panel
          left / centre / right on the top or bottom edge. */}
      <box {...overlayProps(position(), cols)}>
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
            title={" " + safeString(THEMES[themeName()].label + " ")}
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
              title="click for settings"
            >
              {/* Live dot — visually separated from the update/refresh text. */}
              <box
                onMouseUp={() => void openSettings()}
                title="open settings"
              >
                <text fg={palette().accent} font="bold">● LIVE</text>
              </box>
              {/* Relative update time + refresh rate, in muted text. */}
              <text fg={palette().muted} font="dim">
                {updatedLabel() ? `обновлено ${updatedLabel()}` : "—"} · refresh {safeString(refreshMs())}ms
              </text>
            </box>
          </box>
        </Show>
      </box>
    </paletteCtx.Provider>
  );
}

// A single clickable option box inside the unified settings dialog. The current
// value is highlighted with an accent border and a ▸ mark; other options stay
// dim. Clicking applies the value through `onSelect`. The active palette is read
// from `paletteCtx` (set by the dialog's provider) so the highlight matches the
// panel's own look.
function Option(props: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  const palette = useContext(paletteCtx);
  return (
    <box
      width={23}
      border
      borderStyle={props.active ? "single" : "dashed"}
      padding={1}
      backgroundColor={props.active ? palette().bg : "transparent"}
      borderColor={props.active ? palette().accent : palette().muted}
      onMouseUp={props.onSelect}
      title={props.active ? "selected" : "select this option"}
    >
      <text
        fg={props.active ? palette().accent : palette().muted}
        font={props.active ? "bold" : "dim"}
      >
        {(props.active ? "▸ " : "") + props.label}
      </text>
    </box>
  );
}

// The unified settings dialog body: refresh rate, theme and position are all
// edited in ONE window, replacing the three separate `/system-stats-*`
// commands. Each option is a clickable box and the current value is
// highlighted. State is read from the live accessors passed in (the same
// reactive store the panel reads), so a change here applies to the panel
// immediately. `usePlugin` gives the close button access to `dialog.clear`.
function SettingsBody(props: {
  themeName: () => ThemeName;
  setTheme: (name: ThemeName) => void;
  position: () => Position;
  setPosition: (p: Position) => void;
  refreshMs: () => number;
  setRefreshMs: (ms: number) => void;
}) {
  const context = usePlugin();
  const palette = useContext(paletteCtx);
  const close = () => {
    context.ui.dialog.clear();
  };

  return (
    <box
      border
      borderStyle="single"
      padding={1}
      width={50}
      backgroundColor={palette().bg}
      borderColor={palette().border}
      flexDirection="column"
      gap={2}
    >
      {/* Title row + a close button. Escape / click-outside also close it. */}
      <box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <text fg={palette().accent} font="bold">⚙ Stats settings</text>
        <box
          onMouseUp={close}
          title="close"
          paddingX={1}
        >
          <text fg={palette().muted}>×</text>
        </box>
      </box>

      {/* Refresh rate — click a preset to apply it. */}
      <box flexDirection="column" gap={1}>
        <text fg={palette().base} font="bold">Refresh rate</text>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
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
      <box flexDirection="column" gap={1}>
        <text fg={palette().base} font="bold">Theme</text>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          {THEME_NAMES.map((name) => (
            <Option
              label={THEMES[name].label}
              active={name === props.themeName()}
              onSelect={() => props.setTheme(name)}
            />
          ))}
        </box>
      </box>

      {/* Position — click an anchor to apply it. */}
      <box flexDirection="column" gap={1}>
        <text fg={palette().base} font="bold">Position</text>
        <box flexDirection="row" flexWrap="wrap" gap={1}>
          {POSITION_NAMES.map((name) => (
            <Option
              label={POSITION_LABELS[name]}
              active={name === props.position()}
              onSelect={() => props.setPosition(name)}
            />
          ))}
        </box>
      </box>
    </box>
  );
}
