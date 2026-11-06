# opencode-system-stats

A local [OpenCode](https://opencode.ai) plugin that renders a real-time system
stats panel (VRAM, RAM, CPU load, GPU/CPU temperature) directly in the OpenCode
TUI, with a configurable refresh rate.

## Features

- **VRAM** used / total, plus utilization and temperature (color-coded bands).
- **RAM** used / total / free.
- **CPU load %** (two-sample delta on `/proc/stat`) and temperature. CPU temp is
  read cross-platform — LibreHardwareMonitor over HTTP on WSL2/Windows,
  `systeminformation` on bare Linux/macOS, sysfs as a last resort — and the
  panel renders `—` when nothing exposes a sensor.
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
  - CPU temp: layered cascade — LHM over HTTP (WSL2/Windows sensor host),
    `systeminformation` (bare Linux/macOS), then sysfs; `null` when nothing
    exposes a temperature (see "CPU temperature")
- **TUI part** (`src/tui.tsx`) polls the RPC on a timer while the overlay is
  visible and renders it into the root `app` slot as an absolutely-positioned
  overlay (six anchors), instead of a host-docked `session.panel`.

## CPU temperature (LibreHardwareMonitor)

CPU temperature is read with a layered cascade, so it works on the host's OS:

1. **LibreHardwareMonitor (LHM) over HTTP** — primary on **WSL2** (and any box
   whose sensors live on Windows). WSL2 runs in a VM with no access to the
   host's sensors (`/sys/class/thermal` is empty, `systeminformation` returns
   `null`), so temperatures are read from the Windows side.
2. **`systeminformation`** — cross-platform fallback for bare Linux, macOS and
   Windows (non-WSL).
3. **sysfs thermal zones** — last-resort bare-Linux path
   (`/sys/class/thermal/thermal_zone*/temp`, milli-°C).
4. **`null`** — if nothing exposes a temperature, the panel renders `—`.

### Windows setup (needed on WSL2)

LHM must run on Windows with its **Remote Web Server** enabled
(`Tools → Remote Web Server → Run`, default port **8085**, exposes
`http://localhost:8085/data.json`). It is read from WSL with an ordinary
`fetch`. **Run LHM as administrator**, otherwise the CPU sensors are not read.

**Firewall.** Windows Defender blocks inbound `:8085` by default. Allow it:

```powershell
netsh advfirewall firewall add rule name="Allowing Libre Hardware Monitor (LHM) WSL connections" dir=in action=allow protocol=TCP localport=8085
```

**Port forwarding (Windows 10 / NAT).** In NAT mode WSL2 sits behind Windows'
NAT, so `localhost:8085` from WSL may not reach Windows. The code already tries
`localhost` first, then the WSL default gateway IP (NAT) — so it usually works
as-is. If you need `localhost` to reach LHM explicitly:

- **Mirrored networking (Windows 11 22H2+):** set
  `networkingMode=mirrored` in `C:\Users\<you>\.wslconfig`, then
  `wsl --shutdown` and reopen WSL — `localhost` works both ways.
- **Portproxy (Windows 10):** forward the port to WSL's IP (your `eth0`
  address, from `ip addr`). Replace `192.168.1.3` accordingly:

  ```powershell
  netsh interface portproxy add v4tov4 listenport=8085 listenaddress=0.0.0.0 connectport=8085 connectaddress=192.168.1.3
  ```

Override the probe host explicitly with the `SYSTEM_STATS_LHM_HOST` environment
variable if neither of the above applies.

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
- Bare Linux/macOS for out-of-the-box CPU temperature (`systeminformation`).
  On **WSL2** CPU temperature comes from **LibreHardwareMonitor** running on
  Windows — see "CPU temperature" above (needs the Windows firewall rule and,
  under NAT, either mirrored networking or a portproxy).