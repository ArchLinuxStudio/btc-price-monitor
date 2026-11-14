import assert from "node:assert/strict";
import test from "node:test";
import {
  formatNetworkRate,
  formatTemperature,
  formatUsage,
  normalizeSystemMetrics,
  SystemMetricsPoller,
} from "../src/system-metrics.ts";
import type { SystemMetrics } from "../src/system-metrics.ts";

function sample(sampledAtMs = 10_000): SystemMetrics {
  return {
    sampledAtMs,
    uploadBytesPerSecond: 750_000,
    downloadBytesPerSecond: 1_250_000,
    cpuUsagePercent: 12,
    cpuTemperatureC: 52,
    memoryUsagePercent: 64,
    memoryTemperatureC: null,
    gpuUsagePercent: 0,
    gpuTemperatureC: 40,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

test("fresh samples distinguish zero readings from unavailable sensors", () => {
  const value = sample();
  assert.deepEqual(normalizeSystemMetrics(value, 10_500), value);
  assert.equal(formatUsage(value.gpuUsagePercent), "0%");
  assert.equal(formatTemperature(value.memoryTemperatureC), "—");
  assert.equal(formatTemperature(0), "0°C");
});

test("missing, stale and implausibly future timestamps never produce live values", () => {
  for (const value of [null, [], {}, { sampledAtMs: 0 }, { ...sample(), sampledAtMs: NaN }]) {
    assert.equal(normalizeSystemMetrics(value, 10_000), null);
  }
  assert.notEqual(normalizeSystemMetrics(sample(), 13_000), null);
  assert.equal(normalizeSystemMetrics(sample(), 13_001), null);
  assert.equal(normalizeSystemMetrics(sample(12_000), 10_000), null);
});

test("bad sensor values become unavailable without discarding healthy readings", () => {
  const normalized = normalizeSystemMetrics({
    ...sample(),
    uploadBytesPerSecond: Infinity,
    downloadBytesPerSecond: -1,
    cpuUsagePercent: 101,
    cpuTemperatureC: Infinity,
    memoryTemperatureC: "45",
    gpuTemperatureC: -500,
  }, 10_000)!;
  assert.equal(normalized.uploadBytesPerSecond, null);
  assert.equal(normalized.downloadBytesPerSecond, null);
  assert.equal(normalized.cpuUsagePercent, null);
  assert.equal(normalized.cpuTemperatureC, null);
  assert.equal(normalized.memoryTemperatureC, null);
  assert.equal(normalized.gpuTemperatureC, null);
  assert.equal(normalized.memoryUsagePercent, 64);
  assert.equal(normalized.gpuUsagePercent, 0);
});

test("upload and download normalize independently and preserve idle zero rates", () => {
  for (const uploadBytesPerSecond of [undefined, null, -1, "10", NaN, Infinity]) {
    const normalized = normalizeSystemMetrics({ ...sample(), uploadBytesPerSecond }, 10_000)!;
    assert.equal(normalized.uploadBytesPerSecond, null);
    assert.equal(normalized.downloadBytesPerSecond, 1_250_000);
  }
  const idle = normalizeSystemMetrics({ ...sample(), uploadBytesPerSecond: 0, downloadBytesPerSecond: 0 }, 10_000)!;
  assert.equal(idle.uploadBytesPerSecond, 0);
  assert.equal(idle.downloadBytesPerSecond, 0);
});

test("compact formats use decimal byte rates and retain unavailable markers", () => {
  assert.equal(formatNetworkRate(0), "0 B/s");
  assert.equal(formatNetworkRate(500), "500 B/s");
  assert.equal(formatNetworkRate(1_000), "1.0 KB/s");
  assert.equal(formatNetworkRate(1_250_000), "1.3 MB/s");
  assert.equal(formatNetworkRate(999_900_000), "1.0 GB/s");
  assert.equal(formatNetworkRate(Number.MAX_VALUE), ">999 TB/s");
  for (const value of [null, -1, NaN, Infinity]) {
    assert.equal(formatNetworkRate(value), "—");
  }
  assert.equal(formatUsage(99.8), "100%");
  assert.equal(formatUsage(null), "—");
  assert.equal(formatTemperature(52.2), "52°C");
  assert.equal(formatTemperature(null), "—");
});

test("overlapping refreshes share one flight and clear expired data while it is pending", async () => {
  let now = 10_000;
  let reads = 0;
  const pending = deferred<SystemMetrics>();
  const seen: Array<SystemMetrics | null> = [];
  const poller = new SystemMetricsPoller({
    now: () => now,
    read: async () => ++reads === 1 ? sample(now) : pending.promise,
    onChange: (value) => seen.push(value),
  });
  await poller.refresh();
  assert.equal(seen.at(-1)?.cpuTemperatureC, 52);
  now = 11_000;
  const inFlight = poller.refresh();
  await poller.refresh();
  assert.equal(reads, 2);
  now = 13_001;
  await poller.refresh();
  assert.equal(seen.at(-1), null);
  assert.equal(reads, 2);
  pending.resolve(sample(10_000));
  await inFlight;
  assert.equal(seen.at(-1), null);
});

test("read errors clear values and the next successful refresh recovers", async () => {
  let fail = false;
  let latest: SystemMetrics | null = null;
  const poller = new SystemMetricsPoller({
    now: () => 10_000,
    read: async () => {
      if (fail) throw new Error("IPC unavailable");
      return sample();
    },
    onChange: (value) => { latest = value; },
  });
  await poller.refresh();
  assert.deepEqual(latest, sample());
  fail = true;
  await poller.refresh();
  assert.equal(latest, null);
  fail = false;
  await poller.refresh();
  assert.deepEqual(latest, sample());
});

test("disposed polling ignores late replies and cannot issue further reads", async () => {
  const pending = deferred<SystemMetrics>();
  let reads = 0;
  const seen: Array<SystemMetrics | null> = [];
  const poller = new SystemMetricsPoller({
    now: () => 10_000,
    read: () => { reads += 1; return pending.promise; },
    onChange: (value) => seen.push(value),
  });
  const inFlight = poller.refresh();
  poller.dispose();
  pending.resolve(sample());
  await inFlight;
  await poller.refresh();
  assert.deepEqual(seen, [null]);
  assert.equal(reads, 1);
});
