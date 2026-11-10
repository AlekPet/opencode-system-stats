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
- **Three phosphor themes** (`amber`, `green`, `mono`), persisted. Add your own
  with YAML files (see [Custom themes](#custom-themes-yaml)).
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

> ⚠️ **A freshly copied plugin directory needs a service restart.** OpenCode
> watches config files and reloads plugins after a config *save*, but a brand-new
> plugin *directory* dropped into a plugins folder is reliably picked up only after
> `opencode service restart` (then reopen the TUI). If the panel shows
> `RPC is unavailable: opencode-system-stats`, run `opencode service restart`.

### Global install (all projects)

To make the plugin available in **every** OpenCode project and session, install it
into the global plugins directory instead of a project's `.opencode/plugins/`:

```bash
mkdir -p ~/.config/opencode/plugins
ln -s /path/to/opencode-system-stats/.opencode/plugins/opencode-system-stats ~/.config/opencode/plugins/opencode-system-stats
```

This uses the same discovery layout as project plugins — OpenCode scans
`~/.config/opencode/plugins/` for plugin directories.

> 💡 **Symlink = automatic updates.** Symlinking (rather than `cp -r`) means the
> global plugin always points at your source tree: any change you make in
> `.opencode/plugins/opencode-system-stats` is live in the global install
> immediately — no re-copying. If you already copied the plugin earlier, remove
> that copy first (`rm -rf ~/.config/opencode/plugins/opencode-system-stats`) before
> symlinking, so the directory isn't a regular folder holding a stale copy.

> ⚠️ **A freshly symlinked plugin directory needs a service restart.** OpenCode
> watches config files and reloads plugins after a config *save*, but a brand-new
> plugin *directory* dropped into a plugins folder is reliably picked up only after
> `opencode service restart`. If the panel shows
> `RPC is unavailable: opencode-system-stats`, run `opencode service restart`.
> This also applies **after editing the source**: the daemon may not reload the
> plugin bundle on the fly, so restart `opencode service` to pick up your changes.

## Quick Start

To quickly get started with the system stats plugin:

1. **Install the plugin** following the installation steps above
2. **Open OpenCode** and navigate to a project directory
3. **Use one of the following commands** to interact with the plugin:
   - `/system-stats` - Toggle the floating stats overlay open/closed
   - `/system-stats-refresh` - Change the refresh rate (200/500/1000/2000/5000 ms)
   - `/system-stats-theme` - Switch between amber, green, or mono themes
      (plus any [custom themes](#custom-themes-yaml))
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

## Custom themes (YAML)

Beyond the three built-in phosphor palettes, you can add your own themes with
plain YAML files. Themes live **outside the plugin directory** (in a separate
user folder) so they survive plugin updates.

### Setup

1. **Pick a theme directory** anywhere you like, e.g. `~/.config/system-stats-themes`.
2. **Set the `SYSTEM_STATS_THEME_DIR` environment variable** to that directory:
   ```bash
   export SYSTEM_STATS_THEME_DIR="$HOME/.config/system-stats-themes"
   ```
   ⚠️ Set it in the **shell where you launch OpenCode** — the theme directory is
   read by the server half, which is a separate process. If the variable isn't
   set (or the directory is missing), the plugin simply falls back to the
   built-in themes.
3. **Restart OpenCode** (service + TUI) so the new themes appear.
4. Add one theme per YAML/YML file in that directory (see schema below).

The themes are loaded once at startup and merged into the same selector you use
for the built-in themes — no new widget, just more options in the theme list
(`/system-stats-theme` or the panel footer).

### Tutorial: create your first theme

Let's make a "Sunset CRT" theme from scratch.

1. **Create the theme directory** (skip if you already have one):
   ```bash
   mkdir -p "$HOME/.config/system-stats-themes"
   ```

2. **Create a YAML file** for the theme — e.g. `sunset.yml`. It needs a
   `palette` block with the seven phosphor fields:
   ```yaml
   name: sunset
   label: Sunset CRT
   palette:
     bg: "#1a0a00"     # panel background
     accent: "#ff7b00" # active chips / highlighted accents
     base: "#ffb36b"   # primary text (values, headings)
     muted: "#a85d00"  # labels / dim text
     warn: "#ffb000"   # warning values (load/temp bands)
     crit: "#ff3b2f"   # critical values (load/temp bands), errors
     border: "#ff7b00" # panel borders
   ```
   `name` is the id the selector uses; `label` is what you see in the list
   (defaults to `name`). Drop the `name:` line and the filename stem is used
   instead (`sunset.yml` → `sunset`).

3. **Point OpenCode at the directory.** Add the env var to your shell profile
   (`.bashrc` / `.zshrc`) so it's set each time:
   ```bash
   export SYSTEM_STATS_THEME_DIR="$HOME/.config/system-stats-themes"
   ```
   ⚠️ It's read by the server half (a separate process), so it must be set in
   the shell where you launch OpenCode — see [Setup](#setup).

4. **Restart OpenCode** (service + TUI). Your theme joins the same selector you
   use for the built-ins — `/system-stats-theme` or the panel footer.

5. **Verify.** Open the theme selector; your theme should be in the list. If it
   doesn't appear, check the service log — a bad file is skipped with a
   `console.warn` explaining why (see [Errors are non-fatal](#errors-are-non-fatal)).

#### Picking the colors

The seven fields map to real parts of the panel:

| Field      | What it colors                                            |
| ---------- | --------------------------------------------------------- |
| `bg`       | panel background                                          |
| `accent`   | active chip background, highlighted accents, `● LIVE`     |
| `base`     | primary text (values, headings)                           |
| `muted`    | labels / dim / secondary text                             |
| `warn`     | warning values (load / temperature bands)                 |
| `crit`     | critical values (load / temperature bands), error text    |
| `border`   | panel borders                                             |

Every value must be a hex color (`#fff` or `#ff8800`, 3- or 6-digit). `name`
must match `^[a-z0-9][a-z0-9._-]*$`. The easiest starting point is to copy one
of the built-in palettes and tweak it — the amber one is
`bg:#1a1200 accent:#ffb000 base:#ffcc66 muted:#b37a00 warn:#ff9500
crit:#ff5530 border:#ffb000`. For the full rules, see [File schema](#file-schema).

### File schema

Each file is one theme:

```yaml
name: sunset        # optional; id used by the selector
label: Sunset CRT   # optional; shown in the list (defaults to `name`)
palette:
  bg: "#1a0a00"     # background
  accent: "#ff7b00" # highlighted accents / active chips
  base: "#ffb36b"   # primary text
  muted: "#a85d00"  # labels
  warn: "#ffb000"   # warning values
  crit: "#ff3b2f"   # critical values
  border: "#ff7b00" # panel borders
```

Rules:

- **`palette` is required** and must define **all seven** fields: `bg`,
  `accent`, `base`, `muted`, `warn`, `crit`, `border`.
- Every palette value must be a hex color: `#fff` or `#ff8800` (3- or 6-digit).
- **`name`** is the selector id; it must match `^[a-z0-9][a-z0-9._-]*$` (lowercase,
  starts with a letter or digit). If omitted, the filename stem is used
  (`sunset.yml` → `sunset`).
- **`label`** is optional; it defaults to `name`.

### Errors are non-fatal

A bad file is skipped with a warning in the service log and doesn't affect the
others:

- missing or malformed YAML,
- `palette` missing any of the seven fields or with a non-hex value,
- `name` not matching the id pattern.

If two files resolve to the same `name`, the first one (alphabetically) wins and
the rest are skipped with a warning.

### How it works

Themes are scanned, parsed and validated on the **server half** (`src/themes.ts`),
which has filesystem access and `js-yaml`. The validated list is exposed to the
TUI half over a location-scoped RPC call (`src/rpc.ts`), then merged into the
existing theme map at setup (`src/tui.tsx`) so the built-in and custom themes
share one code path.

### Example themes

This repo ships two ready-made samples in [`examples/themes/`](../../../../examples/themes/)
at the repo root — `sunset.yaml` and `c64.yaml`. Copy one into your theme
directory and point `SYSTEM_STATS_THEME_DIR` at it (see
[`examples/themes/_README.md`](../../../../examples/themes/_README.md)).

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