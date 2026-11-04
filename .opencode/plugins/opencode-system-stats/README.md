# opencode-system-stats

A local [OpenCode](https://opencode.ai) plugin that renders a real-time system
stats panel (VRAM, RAM, CPU load, GPU/CPU temperature) directly in the OpenCode
TUI, with a configurable refresh rate.

## Features

- **VRAM** used / total, plus utilization and temperature (color-coded bands).
- **RAM** used / total / free.
- **CPU load %** (two-sample delta on `/proc/stat`) and temperature when the
  host exposes thermal zones.
- **Configurable refresh rate** via a select dialog
  (`200 / 500 / 1000 / 2000 / 5000` ms), persisted across sessions.
- **Floating overlay** that can sit in any corner or at the top/bottom centre of
  the screen (six anchors, persisted), like the built-in debug overlay.
- **Three phosphor themes** (`amber`, `green`, `mono`), persisted.
- Graceful degradation: any field that can't be read falls back to a safe
  default, so the panel never crashes.

## Install

Local plugins under `.opencode/plugins/` are auto-loaded — no configuration
required. Follow these steps to install the plugin:

1. **Ensure you have OpenCode v2.x installed** on your system
2. **Navigate to your project directory** where you want to install the plugin:
   ```bash
   cd /path/to/your/project
   ```
3. **Create the plugins directory structure** if it doesn't exist:
   ```bash
   mkdir -p .opencode/plugins
   ```
4. **Place this plugin in the correct location** by copying or moving the entire directory:
   ```bash
   cp -r /path/to/opencode-system-stats/.opencode/plugins/opencode-system-stats .opencode/plugins/
   ```
   
   OR
   
   ```bash
   mv /path/to/opencode-system-stats .opencode/plugins/opencode-system-stats
   ```

5. **Restart OpenCode service and client** to load the new plugin:
   ```bash
   # Restart the OpenCode service
   opencode serve --service
   
   # Restart the OpenCode TUI client (if running)
   opencode
   ```

The plugin is automatically loaded by OpenCode when placed in the correct location.

## Quick Start

To quickly get started with the system stats plugin:

1. **Install the plugin** following the installation steps above
2. **Open OpenCode** and navigate to a project directory
3. **Use one of the following commands** to interact with the plugin:
   - `/system-stats` - Toggle the floating stats overlay open/closed
   - `/system-stats-refresh` - Change the refresh rate (200/500/1000/2000/5000 ms)
   - `/system-stats-theme` - Switch between amber, green, or mono themes
   - `/system-stats-position` - Move the overlay to different screen positions

4. **To see the stats panel**, type `/system-stats` in the command palette (Ctrl+P) or use the slash command directly

5. **Customize your experience** by using the commands above or clicking on the footer of the panel which also opens the refresh rate selector

## How it works

- **Server part** (`src/index.ts`) registers a single RPC method `stats()`.
- **RPC contract** (`src/rpc.ts`) defines the shared JSON Schema.
- **Host stats** (`src/stats.ts`) collect data on the server side:
  - GPU: `nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv`
  - RAM: `/proc/meminfo` (used = Total − Available)
  - CPU load: two `/proc/stat` samples ~150 ms apart
  - CPU temp: `/sys/class/thermal/thermal_zone*/temp` (null when unavailable,
    e.g. under WSL where only `cooling_device*` exist)
- **TUI part** (`src/tui.tsx`) polls the RPC on a timer while the overlay is
  visible and renders it into the root `app` slot as an absolutely-positioned
  overlay (six anchors), instead of a host-docked `session.panel`.

## Debugging

If you encounter issues with the plugin:

1. **Check the service logs**: The OpenCode service logs are located at:
   ```
   /home/alekpet/.local/share/opencode/log/opencode.log
   ```

2. **Look for error messages** that may contain:
   - `msg="loading plugin"` - to confirm plugin loading
   - `rpc.unavailable` - indicates RPC registration issues
   - `TextNodeRenderable only accepts string` - the specific error you're experiencing

3. **Restart OpenCode**: After making changes to the plugin code or when encountering persistent errors, restart both:
   - The OpenCode service (`opencode serve --service`)
   - The OpenCode TUI client (`opencode`)

## Development

```bash
cd .opencode/plugins/opencode-system-stats
npx tsc --noEmit      # type-check (uses tsconfig.json)
```

> The plugin is authored in TypeScript/TSX but OpenCode's runtime transpiles it
> on the fly; `tsconfig.json` is only for editor/IDE support.

## Requirements

- OpenCode v2.x
- `nvidia-smi` on PATH for GPU data (RAM/CPU work without it).
- Linux/WSL (`/proc/*`, `/sys/class/thermal/*`).