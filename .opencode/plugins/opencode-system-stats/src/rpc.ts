import { Rpc } from "@opencode/plugin/rpc"

/** Shared data contract for the host stats snapshot. */
export interface Stats {
  ram: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
  }
  cpu: {
    loadPct: number
    tempC: number | null
  }
  gpu: {
    name: string | null
    usedMiB: number
    totalMiB: number
    tempC: number | null
    utilPct: number
  }
  collectedAt: number
}

/**
 * A user-supplied custom theme, loaded from a YAML file and validated on the
 * server half, then exposed to the TUI half via the `themes` method. Ties to the
 * TUI's local `Palette` by shape (the same 7 hex fields).
 */
export interface CustomTheme {
  /** Stable unique id (`^[a-z0-9][a-z0-9._-]*$`); the selector `value`. */
  name: string
  /** Human-readable name in the selector; falls back to `name`. */
  label?: string
  /** Always `true` — marks it as a user theme, not a built-in palette. */
  custom: boolean
  /** The 7-field phosphor palette. */
  palette: {
    bg: string
    accent: string
    base: string
    muted: string
    warn: string
    crit: string
    border: string
  }
}

/**
 * RPC contract shared between the server part (implements) and the TUI part
 * (calls). The plugin `id` comes from the server part's `Plugin.define`; this
 * `id` only identifies the contract itself.
 */
export const Stats = Rpc.define({
  id: "opencode-system-stats",
  methods: {
    stats: {
      // `stats` takes no arguments, but `input` must still be present: the
      // runtime decodes it unconditionally (`KD(method.input, arg)`), and with
      // `input` omitted the schema check throws
      // `TypeError: e is not an Object (evaluating '"~standard" in e')`,
      // surfacing as HTTP 500 `rpc.internal`. Per the RPC docs, the "no value"
      // form is an empty object schema (same rule as event payloads).
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          ram: {
            type: "object",
            properties: {
              totalBytes: { type: "number" },
              usedBytes: { type: "number" },
              freeBytes: { type: "number" },
            },
            required: ["totalBytes", "usedBytes", "freeBytes"],
            additionalProperties: false,
          },
          cpu: {
            type: "object",
            properties: {
              loadPct: { type: "number" },
              tempC: { type: ["number", "null"] },
            },
            required: ["loadPct", "tempC"],
            additionalProperties: false,
          },
          gpu: {
            type: "object",
            properties: {
              name: { type: ["string", "null"] },
              usedMiB: { type: "number" },
              totalMiB: { type: "number" },
              tempC: { type: ["number", "null"] },
              utilPct: { type: "number" },
            },
            required: ["name", "usedMiB", "totalMiB", "tempC", "utilPct"],
            additionalProperties: false,
          },
          collectedAt: { type: "number" },
        },
        required: ["ram", "cpu", "gpu", "collectedAt"],
        additionalProperties: false,
      },
    },
    themes: {
      // No arguments; `input` is present for the same schema-decoding reason as
      // `stats` above.
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      // One entry per valid user theme. `palette` is declared HERE on purpose:
      // the item schema has `additionalProperties: false`, so the server's
      // output validator STRIPS any property not listed below. This very bug
      // cost us a theme — without `palette` in the schema the server returned
      // `{ name, label, custom }`, the TUI saw no palette and skipped every
      // custom theme as "malformed". Declaring the 7 hex strings (all required)
      // lets them survive the round-trip.
      output: {
        type: "object",
        properties: {
          themes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                label: { type: ["string", "null"] },
                custom: { type: "boolean" },
                palette: {
                  type: "object",
                  properties: {
                    bg: { type: "string" },
                    accent: { type: "string" },
                    base: { type: "string" },
                    muted: { type: "string" },
                    warn: { type: "string" },
                    crit: { type: "string" },
                    border: { type: "string" },
                  },
                  required: [
                    "bg", "accent", "base", "muted", "warn", "crit", "border",
                  ],
                  additionalProperties: false,
                },
              },
              required: ["name", "custom", "palette"],
              additionalProperties: false,
            },
          },
        },
        required: ["themes"],
        additionalProperties: false,
      },
    },
  },
  // `events` is a required field of Rpc.define: Rpc.register iterates the
  // contract's events via Object.entries before doing anything else, so a
  // contract without an `events` field throws
  // "Object.entries requires that input parameter not be null or undefined"
  // during registration. This plugin only polls the `stats()` method and never
  // emits/subscribes events, so the map is intentionally empty.
  events: {},
})
