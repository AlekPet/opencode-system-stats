import { Plugin } from "@opencode/plugin"
import { Stats } from "./rpc.js"
import { collectStats } from "./stats.js"

export default Plugin.define({
  id: "opencode-view-stats",
  async setup(ctx) {
    await ctx.rpc.register(Stats, {
      stats: async (_input, context) => {
        // context.signal lets an abort (session stop) cancel the in-flight
        // nvidia-smi / /proc/stat sampling.
        return collectStats(context.signal ?? undefined)
      },
    })
  },
})
