import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTemperatureState,
  temperatureStatusView,
  TemperatureStatusReader,
  type TemperatureState,
} from "../src/temperature-status.ts";

test("temperature status distinguishes missing drivers, unreadable hardware and missing components", () => {
  const driver = temperatureStatusView({ cpuStatus: "driver-missing", memoryStatus: "driver-missing" });
  assert.match(driver.description, /安装程序修复.*包含在安装包/);
  assert.doesNotMatch(driver.description, /官网|手动安装/);
  const permission = temperatureStatusView({ cpuStatus: "permission-required", memoryStatus: "permission-required" });
  assert.equal(permission.cpu, "需要管理员权限");
  assert.match(permission.description, /启动时.*管理员.*Windows 授权/);
  const absent = temperatureStatusView({ cpuStatus: "available", memoryStatus: "unavailable" });
  assert.equal(absent.cpu, "已读取");
  assert.equal(absent.memory, "未读取到传感器");
  assert.match(absent.description, /不代表硬件没有传感器/);
  const broken = temperatureStatusView({ cpuStatus: "helper-missing", memoryStatus: "helper-missing" });
  assert.match(broken.description, /重新安装完整版本/);
});

test("invalid statuses become read errors rather than claiming a missing sensor or driver", () => {
  for (const invalid of [null, undefined, false, { cpuStatus: "toString", memoryStatus: "unknown" }]) {
    const state = normalizeTemperatureState(invalid);
    assert.deepEqual(state, { cpuStatus: "error", memoryStatus: "error" });
  }
  assert.deepEqual(normalizeTemperatureState({ cpuStatus: "available" }), {
    cpuStatus: "available", memoryStatus: "error",
  });
});

test("hidden windows skip reads and focus/timer requests share one in-flight read", async () => {
  let resolve!: (value: unknown) => void;
  const deferred = new Promise<unknown>((done) => { resolve = done; });
  let visible = false;
  let reads = 0;
  const states: TemperatureState[] = [];
  const reader = new TemperatureStatusReader(
    async () => { reads += 1; return deferred; },
    () => visible,
    (state) => states.push(state),
  );
  await reader.refresh();
  assert.equal(reads, 0);
  visible = true;
  const reading = reader.refresh();
  await reader.refresh();
  assert.equal(reads, 1);
  visible = false;
  resolve({ cpuStatus: "available", memoryStatus: "unavailable" });
  await reading;
  assert.deepEqual(states, []);
  visible = true;
  await reader.refresh();
  assert.equal(reads, 2);
  assert.deepEqual(states, [{ cpuStatus: "available", memoryStatus: "unavailable" }]);
});

test("a failed read clears previous available status and later reads recover", async () => {
  let fail = false;
  const states: TemperatureState[] = [];
  const reader = new TemperatureStatusReader(async () => {
    if (fail) throw new Error("IPC failure");
    return { cpuStatus: "available", memoryStatus: "available" };
  }, () => true, (state) => states.push(state));
  await reader.refresh();
  fail = true;
  await reader.refresh();
  assert.deepEqual(states.at(-1), { cpuStatus: "error", memoryStatus: "error" });
  fail = false;
  await reader.refresh();
  assert.deepEqual(states.at(-1), { cpuStatus: "available", memoryStatus: "available" });
});
