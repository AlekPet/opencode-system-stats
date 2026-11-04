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
- Graceful degradation: any field that can't be read falls back to a safe
  default, so the panel never crashes.

## Install

Local plugins under `.opencode/plugins/` are auto-loaded — no configuration
required. Place this directory as a sibling and OpenCode picks it up on restart:

```
<project>/.opencode/plugins/opencode-system-stats/   ← this repo
```

## Usage

| Command        | Description                                    |
| -------------- | ---------------------------------------------- |
| `/system-stats`  | Toggle the stats panel open/closed.            |
| `/system-stats-refresh` | Choose the refresh rate (dialog preset). |

Both commands are also available from the palette (`<Cmd/Ctrl+P>`).

## How it works

- **Server part** (`src/index.ts`) registers a single RPC method `stats()`.
- **RPC contract** (`src/rpc.ts`) defines the shared JSON Schema.
- **Host stats** (`src/stats.ts`) collect data on the server side:
  - GPU: `nvidia-smi --query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu --format=csv`
  - RAM: `/proc/meminfo` (used = Total − Available)
  - CPU load: two `/proc/stat` samples ~150 ms apart
  - CPU temp: `/sys/class/thermal/thermal_zone*/temp` (null when unavailable,
    e.g. under WSL where only `cooling_device*` exist)
- **TUI part** (`src/tui.tsx`) polls the RPC on a timer and renders the panel as
  a `session.panel` contribution.

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
