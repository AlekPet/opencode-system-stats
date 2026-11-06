import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import type { Stats } from "./rpc.js"

/**
 * Host-side data collection for the system-stats plugin.
 *
 * Every collector is defensive: on any failure it returns a safe fallback so the
 * panel keeps rendering. CPU temperature is layered across platforms:
 * LibreHardwareMonitor over HTTP on this WSL2 host (thermal zones are absent in
 * WSL), sysfs thermal zones on bare Linux — either degrades to null. Other
 * collectors degrade per-field.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function run(cmd: string, args: string[], signal: AbortSignal | undefined, timeoutMs = 5000): string {
  const res = spawnSync(cmd, args, {
    encoding: "utf8",
    timeout: timeoutMs,
    signal,
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`)
  return res.stdout
}

function parseMiB(raw: string): number {
  const m = raw.trim().match(/([\d.]+)/)
  return m ? Math.round(parseFloat(m[1])) : 0
}

interface GpuInfo {
  name: string | null
  usedMiB: number
  totalMiB: number
  tempC: number | null
  utilPct: number
}

interface RamInfo {
  totalBytes: number
  usedBytes: number
  freeBytes: number
}

interface CpuInfo {
  loadPct: number
  tempC: number | null
}

/**
 * nvidia-smi (verified working on this WSL wrapper):
 *   --query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu
 *   --format=csv
 * Plain CSV (no noheader/nounit modifiers — those are rejected). Split on ",".
 */
function readGpu(signal?: AbortSignal): GpuInfo {
  const empty: GpuInfo = { name: null, usedMiB: 0, totalMiB: 0, tempC: null, utilPct: 0 }
  try {
    const out = run(
      "nvidia-smi",
      [
        "--query-gpu=name,memory.used,memory.total,temperature.gpu,utilization.gpu",
        "--format=csv",
      ],
      signal,
    )
    const lines = out.trim().split("\n")
    if (lines.length < 2) return empty
    const parts = lines[1].split(",").map((s) => s.trim())
    if (parts.length < 5) return empty
    return {
      name: parts[0] || null,
      usedMiB: parseMiB(parts[1]),
      totalMiB: parseMiB(parts[2]),
      tempC: parts[3] ? parseInt(parts[3], 10) : null,
      utilPct: parseInt(parts[4], 10) || 0,
    }
  } catch {
    return empty
  }
}

/** /proc/meminfo (values in kB -> *1024). Used = Total - Available. */
function readRam(): RamInfo {
  const empty: RamInfo = { totalBytes: 0, usedBytes: 0, freeBytes: 0 }
  try {
    const text = readFileSync("/proc/meminfo", "utf8")
    const get = (key: string): number => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))
      return m ? parseInt(m[1], 10) : 0
    }
    const total = get("MemTotal")
    const available = get("MemAvailable")
    const free = get("MemFree")
    const used = total > available ? total - available : total - free
    return { totalBytes: total * 1024, usedBytes: used * 1024, freeBytes: free * 1024 }
  } catch {
    return empty
  }
}

interface StatSample {
  total: number
  idle: number
}

function readStat(): StatSample {
  const line = readFileSync("/proc/stat", "utf8")
    .split("\n")
    .find((l) => l.startsWith("cpu "))
  if (!line) return { total: 0, idle: 0 }
  const nums = line.split(/\s+/).slice(1).map(Number)
  const total = nums.reduce((a, b) => a + b, 0)
  const idle = (nums[3] || 0) + (nums[4] || 0) // idle + iowait
  return { total, idle }
}

/** Sample /proc/stat twice (~150ms gap): load% = (Δtotal − Δidle) / Δtotal × 100 */
async function readCpuLoad(signal?: AbortSignal): Promise<number> {
  try {
    const a = readStat()
    await sleep(150)
    if (signal?.aborted) return 0
    const b = readStat()
    const dTotal = b.total - a.total
    const dIdle = b.idle - a.idle
    if (dTotal <= 0) return 0
    return Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100))
  } catch {
    return 0
  }
}

// --- CPU temperature: layered across platforms -------------------------------
//
// The active host is WSL2, where /sys/class/thermal has no thermal_zone* nodes,
// so the bare-Linux path (readCpuTempSysfs) resolves to null. In WSL2 sensor
// data lives on the Windows side, so the first method talks to LibreHardware-
// Monitor's remote web server over HTTP and reads the package/core temp back.
// On a bare Linux box the sysfs path is used instead.

interface LhmNode {
  Text: string
  Value?: string
  Children?: LhmNode[]
}

interface LhmSensor {
  path: string
  celsius: number
}

// Hosts to probe, in order. `SYSTEM_STATS_LHM_HOST` forces a single host (e.g.
// the Windows LAN IP when WSL runs in NAT mode and Windows sits on another
// subnet). Otherwise try loopback (mirrored networking on Win11 22H2+) and the
// WSL default gateway (NAT mode) — on this host the gateway (172.25.192.1)
// answers :8085, reaching LHM on Windows.
function lhmHosts(): string[] {
  const explicit = process.env.SYSTEM_STATS_LHM_HOST?.trim()
  if (explicit) return [explicit]
  const hosts = ["localhost"]
  try {
    const out = run("ip", ["route", "show", "default"], undefined)
    const gw = out.match(/default via (\S+)/)?.[1]
    if (gw) hosts.push(gw)
  } catch {
    // no routing table / `ip` missing -> loopback only
  }
  return hosts
}

async function fetchLhm(signal?: AbortSignal): Promise<LhmNode | null> {
  for (const host of lhmHosts()) {
    const url = `http://${host}:8085/data.json`
    try {
      // A short per-host timeout so a down/unreachable LHM never stalls the
      // refresh loop; any failure falls through to the next candidate.
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return (await res.json()) as LhmNode
    } catch {
      // try next candidate
    }
  }
  return null
}

// Walk the LHM tree collecting every node whose value is a temperature. Russian
// locale arrives as "79,0 °C", so parse the first number after normalising the
// decimal comma.
function collectLhmSensors(
  node: LhmNode,
  path: string[] = [],
  out: LhmSensor[] = [],
): LhmSensor[] {
  const p = [...path, node.Text]
  const value = node.Value
  if (value && /°C/i.test(value)) {
    const m = value.replace(",", ".").match(/(-?\d+(?:\.\d+))/)
    if (m) out.push({ path: p.join(" / "), celsius: parseFloat(m[1]) })
  }
  ;(node.Children || []).forEach((c) => collectLhmSensors(c, p, out))
  return out
}

// Prefer the aggregate CPU temperature (Intel "CPU Package", AMD "Tctl/Tdie")
// over per-core readings and over "Distance to TjMax".
function pickCpuTemp(sensors: LhmSensor[]): number | null {
  const ranked = sensors
    .filter((s) => /CPU Package|Tctl|Tdie/i.test(s.path))
    .sort((a, b) => cpuRank(a.path) - cpuRank(b.path))
  return ranked.length ? ranked[0].celsius : null
}
function cpuRank(path: string): number {
  if (/CPU Package|Tctl|Tdie/i.test(path)) return 0
  if (/Core Average/i.test(path)) return 1
  return 2
}

// Method 1: LHM over HTTP (WSL2 / Windows sensor host). async because of fetch.
async function readCpuTempLhm(signal?: AbortSignal): Promise<number | null> {
  const tree = await fetchLhm(signal)
  if (!tree) return null
  return pickCpuTemp(collectLhmSensors(tree))
}

// Method 2: bare-Linux thermal zones. Returns null when no cpu/core zone exists
// (as on this WSL2 host). Temps are stored in milli-Celsius.
function readCpuTempSysfs(): number | null {
  try {
    for (let i = 0; i < 5; i++) {
      const typePath = `/sys/class/thermal/thermal_zone${i}/type`
      const tempPath = `/sys/class/thermal/thermal_zone${i}/temp`
      let type = ""
      try {
        type = readFileSync(typePath, "utf8").trim().toLowerCase()
      } catch {
        continue
      }
      if (type.includes("cpu") || type.includes("core") || type.includes("x86_pkg")) {
        const raw = readFileSync(tempPath, "utf8").trim()
        const c = parseInt(raw, 10)
        if (!Number.isNaN(c) && c > 0) return c / 1000
      }
    }
    return null
  } catch {
    return null
  }
}

// Layered CPU temperature. Order matters: LHM first (this WSL2 host), then
// sysfs (bare Linux). Any method returning null is skipped by collectStats.
async function readCpuTemp(signal?: AbortSignal): Promise<number | null> {
  const fromLhm = await readCpuTempLhm(signal)
  if (fromLhm != null) return fromLhm
  return readCpuTempSysfs()
}

export async function collectStats(signal?: AbortSignal): Promise<Stats> {
  const gpu = readGpu(signal)
  const ram = readRam()
  const temp = await readCpuTemp(signal)
  const load = await readCpuLoad(signal)
  return {
    ram,
    cpu: { loadPct: Math.round(load * 10) / 10, tempC: temp },
    gpu,
    collectedAt: Date.now(),
  }
}

/** Format bytes as human-readable GB. */
export function formatGB(bytes: number): string {
  if (!bytes) return "—"
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
