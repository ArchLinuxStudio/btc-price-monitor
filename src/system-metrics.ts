export interface SystemMetrics {
  sampledAtMs: number;
  uploadBytesPerSecond: number | null;
  downloadBytesPerSecond: number | null;
  cpuUsagePercent: number | null;
  cpuTemperatureC: number | null;
  memoryUsagePercent: number | null;
  memoryTemperatureC: number | null;
  gpuUsagePercent: number | null;
  gpuTemperatureC: number | null;
}

export const SYSTEM_METRICS_INTERVAL_MS = 1_000;
export const SYSTEM_METRICS_MAX_AGE_MS = 3_000;

function numberInRange(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

export function normalizeSystemMetrics(value: unknown, now: number): SystemMetrics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const metrics = value as Record<string, unknown>;
  const sampledAtMs = numberInRange(metrics.sampledAtMs, 1, Number.MAX_SAFE_INTEGER);
  if (sampledAtMs === null || !Number.isFinite(now)
    || now - sampledAtMs > SYSTEM_METRICS_MAX_AGE_MS || sampledAtMs - now > 1_000) return null;
  return {
    sampledAtMs,
    uploadBytesPerSecond: numberInRange(metrics.uploadBytesPerSecond, 0, Number.MAX_VALUE),
    downloadBytesPerSecond: numberInRange(metrics.downloadBytesPerSecond, 0, Number.MAX_VALUE),
    cpuUsagePercent: numberInRange(metrics.cpuUsagePercent, 0, 100),
    cpuTemperatureC: numberInRange(metrics.cpuTemperatureC, -100, 200),
    memoryUsagePercent: numberInRange(metrics.memoryUsagePercent, 0, 100),
    memoryTemperatureC: numberInRange(metrics.memoryTemperatureC, -100, 200),
    gpuUsagePercent: numberInRange(metrics.gpuUsagePercent, 0, 100),
    gpuTemperatureC: numberInRange(metrics.gpuTemperatureC, -100, 200),
  };
}

export function formatNetworkRate(bytesPerSecond: number | null): string {
  if (numberInRange(bytesPerSecond, 0, Number.MAX_VALUE) === null) return "—";
  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];
  let value = bytesPerSecond!;
  let unit = 0;
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1_000;
    unit += 1;
  }
  if (value >= 999.5) return ">999 TB/s";
  return `${value.toFixed(unit > 0 && value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatUsage(percent: number | null): string {
  return numberInRange(percent, 0, 100) === null ? "—" : `${Math.round(percent!)}%`;
}

export function formatTemperature(celsius: number | null): string {
  return numberInRange(celsius, -100, 200) === null ? "—" : `${Math.round(celsius!)}°C`;
}

interface SystemMetricsPollerOptions {
  read: () => Promise<unknown>;
  onChange: (metrics: SystemMetrics | null) => void;
  now?: () => number;
}

/** One IPC request at a time; a slow request cannot keep stale values visible. */
export class SystemMetricsPoller {
  private readonly read: () => Promise<unknown>;
  private readonly onChange: (metrics: SystemMetrics | null) => void;
  private readonly now: () => number;
  private latest: SystemMetrics | null = null;
  private inFlight = false;
  private active = true;

  constructor(options: SystemMetricsPollerOptions) {
    this.read = options.read;
    this.onChange = options.onChange;
    this.now = options.now ?? Date.now;
  }

  async refresh(): Promise<void> {
    if (!this.active) return;
    this.latest = normalizeSystemMetrics(this.latest, this.now());
    this.onChange(this.latest);
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const value = await this.read();
      if (this.active) {
        this.latest = normalizeSystemMetrics(value, this.now());
        this.onChange(this.latest);
      }
    } catch {
      if (this.active) {
        this.latest = null;
        this.onChange(null);
      }
    } finally {
      this.inFlight = false;
    }
  }

  dispose(): void {
    this.active = false;
    this.latest = null;
  }
}
