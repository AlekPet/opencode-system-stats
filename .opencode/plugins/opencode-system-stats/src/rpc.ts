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
  },
  // `events` is a required field of Rpc.define: Rpc.register iterates the
  // contract's events via Object.entries before doing anything else, so a
  // contract without an `events` field throws
  // "Object.entries requires that input parameter not be null or undefined"
  // during registration. This plugin only polls the `stats()` method and never
  // emits/subscribes events, so the map is intentionally empty.
  events: {},
})
