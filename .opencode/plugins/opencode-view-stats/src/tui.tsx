import { Show, createSignal, createEffect, onCleanup } from "solid-js"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { Stats } from "./rpc.js"
import type { Stats as StatsSnapshot } from "./rpc.js"
import { formatGB } from "./stats.js"

const PANEL_ID = "view-stats"

const PRESETS = [
  { value: 200, label: "200 ms — fastest" },
  { value: 500, label: "500 ms — smooth" },
  { value: 1000, label: "1000 ms — default" },
  { value: 2000, label: "2000 ms — light" },
  { value: 5000, label: "5000 ms — background" },
]

function fmtTemp(c: number | null): string {
  return c == null ? "—" : `${Math.round(c)}°C`
}

// A single labeled stat row: label (muted) | value (right aligned).
function StatRow(props: {
  label: string
  value: string
  accent?: string
}) {
  const context = usePlugin()
  return (
    <box flexDirection="row" alignItems="center" justifyContent="space-between">
      <text fg={context.theme.text.muted}>{props.label}</text>
      <text fg={props.accent ?? context.theme.text.base}>{props.value}</text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode-view-stats.tui",
  async setup(context) {
    // Persisted, reactive refresh interval (ms). `storage.store` returns
    // `[state, setState]` where `state` is a reactive store (built-in panels
    // read it as `state.prop`); the second element is the async setter.
    const [settings, setSettings] = context.storage.store("view-stats", {
      initial: { refreshMs: 1000 },
    })
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
          id: "opencode-view-stats.refresh",
          title: "Set stats refresh rate",
          palette: true,
          slash: { name: "view-stats-refresh" },
          run: async () => {
            const chosen = await context.ui.dialog.select({
              title: "Stats refresh rate",
              current: `${refreshMs()}ms`,
              options: PRESETS.map((p) => ({
                title: p.label,
                value: `${p.value}ms`,
              })),
            })
            if (chosen) {
              const ms = Number.parseInt(chosen.replace(/ms$/, ""), 10)
              if (!Number.isNaN(ms) && ms > 0) setRefreshMs(ms)
            }
          },
        },
      ],
    }))

    // Command: toggle the panel open/closed.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-view-stats.toggle",
          title: "Toggle system stats",
          palette: true,
          slash: { name: "view-stats" },
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
}) {
  const context = usePlugin()
  const theme = context.theme
  const cols = Math.max(28, Math.min(props.width ?? 48, 64))
  const latest = props.latest
  const error = props.error
  const refreshMs = props.refreshMs

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
    if (value == null) return theme.text.muted
    if (value >= crit) return "#ff5555"
    if (value >= warn) return "#ffb000"
    return theme.text.base
  }

  return (
    <Show
      // Compare to `null` (not pass the snapshot itself) so the tree is built
      // once and only its reactive attributes update on each refresh.
      when={latest() !== null}
      fallback={
        <box flexDirection="column" gap={1}>
          <text fg={theme.text.muted}>Collecting stats…</text>
          <Show when={error()}>
            <text fg="#ff5555">{error()}</text>
          </Show>
        </box>
      }
    >
      <box
        border
        borderStyle="rounded"
        padding={2}
        gap={1}
        width={cols}
        backgroundColor="#1e1e1e"
      >
        <text font="bold" fg={theme.text.accent}>
          System Stats
        </text>

        <box flexDirection="column" gap={1} marginY={1}>
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

        <box flexDirection="column" gap={1} marginY={1}>
          <StatRow
            label="RAM"
            value={`${formatGB(latest()!.ram.usedBytes)} / ${formatGB(
              latest()!.ram.totalBytes,
            )}`}
          />
          <StatRow label="  Free" value={formatGB(latest()!.ram.freeBytes)} />
        </box>

        <box flexDirection="column" gap={1} marginY={1}>
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

        <text marginY={1} fg={theme.text.muted} font="dim">
          {updatedLabel() ? `обновлено ${updatedLabel()}` : "—"} · refresh{" "}
          {refreshMs()}ms
        </text>
      </box>
    </Show>
  )
}
