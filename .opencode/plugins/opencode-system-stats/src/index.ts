import { Plugin } from "@opencode/plugin"
import { Stats } from "./rpc.js"
import { collectStats } from "./stats.js"
import { loadThemes } from "./themes.js"

export default Plugin.define({
  id: "opencode-system-stats",
  async setup(ctx) {
    await ctx.rpc.register(Stats, {
      stats: async (_input, context) => {
        // context.signal lets an abort (session stop) cancel the in-flight
        // nvidia-smi / /proc/stat sampling.
        return collectStats(context.signal ?? undefined)
      },
      // Expose user custom themes (scanned from `SYSTEM_STATS_THEME_DIR` on the
      // server half). Called once at setup by the TUI half. A missing directory
      // or bad files never throw — `loadThemes` warns and returns what it can.
      themes: async () => {
        return { themes: loadThemes(process.env.SYSTEM_STATS_THEME_DIR) }
      },
    })
  },
})
