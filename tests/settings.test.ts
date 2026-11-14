import assert from "node:assert/strict";
import test from "node:test";
import { AutostartSettings, type AutostartState } from "../src/settings-state.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("initialization and refresh read the system without enabling autostart", async () => {
  let enabled = false;
  const writes: boolean[] = [];
  const settings = new AutostartSettings({
    getEnabled: async () => enabled,
    setEnabled: async (value) => { writes.push(value); return value; },
  }, () => {});

  assert.equal(settings.getState().enabled, null);
  await settings.setEnabled(true);
  await settings.refresh();
  assert.equal(settings.getState().enabled, false);
  assert.equal(settings.getState().phase, "ready");
  enabled = true;
  await settings.refresh();
  assert.equal(settings.getState().enabled, true);
  assert.deepEqual(writes, []);
});

test("failed reads keep state unknown and can be retried", async () => {
  let fail = true;
  const settings = new AutostartSettings({
    getEnabled: async () => {
      if (fail) throw new Error("unavailable");
      return false;
    },
    setEnabled: async (value) => value,
  }, () => {});

  await settings.refresh();
  assert.equal(settings.getState().enabled, null);
  assert.equal(settings.getState().phase, "error");
  assert.match(settings.getState().message, /读取/);
  fail = false;
  await settings.refresh();
  assert.equal(settings.getState().enabled, false);
  assert.equal(settings.getState().phase, "ready");
});

test("enabling and disabling wait for native confirmation before changing the toggle", async () => {
  const enable = deferred<boolean>();
  const writes: boolean[] = [];
  const updates: AutostartState[] = [];
  const settings = new AutostartSettings({
    getEnabled: async () => false,
    setEnabled: async (value) => {
      writes.push(value);
      return value ? enable.promise : false;
    },
  }, (state) => updates.push(state));

  await settings.refresh();
  const saving = settings.setEnabled(true);
  assert.equal(settings.getState().phase, "saving");
  assert.equal(settings.getState().enabled, false);
  enable.resolve(true);
  await saving;
  assert.equal(settings.getState().enabled, true);
  assert.match(settings.getState().message, /已开启/);
  await settings.setEnabled(false);
  assert.equal(settings.getState().enabled, false);
  assert.match(settings.getState().message, /已关闭/);
  assert.deepEqual(writes, [true, false]);
  assert.equal(updates.filter((state) => state.phase === "saving").length, 2);
});

test("failed writes read the actual state back instead of leaving an optimistic value", async () => {
  let reads = 0;
  const settings = new AutostartSettings({
    getEnabled: async () => { reads += 1; return false; },
    setEnabled: async () => { throw new Error("permission denied"); },
  }, () => {});

  await settings.refresh();
  await settings.setEnabled(true);
  assert.equal(reads, 2);
  assert.equal(settings.getState().enabled, false);
  assert.equal(settings.getState().phase, "error");
  assert.match(settings.getState().message, /当前状态/);
});

test("a partial native failure uses the readback value rather than a stale rollback", async () => {
  let enabled = false;
  const settings = new AutostartSettings({
    getEnabled: async () => enabled,
    setEnabled: async (value) => {
      enabled = value;
      throw new Error("readback failed after write");
    },
  }, () => {});

  await settings.refresh();
  await settings.setEnabled(true);
  assert.equal(settings.getState().enabled, true);
  assert.equal(settings.getState().phase, "error");
});

test("when write and readback both fail, further writes wait for a successful refresh", async () => {
  let failRead = false;
  let writes = 0;
  const settings = new AutostartSettings({
    getEnabled: async () => {
      if (failRead) throw new Error("state unavailable");
      return true;
    },
    setEnabled: async () => {
      writes += 1;
      failRead = true;
      throw new Error("write failed");
    },
  }, () => {});

  await settings.refresh();
  await settings.setEnabled(false);
  assert.equal(settings.getState().enabled, null);
  assert.equal(settings.getState().phase, "error");
  await settings.setEnabled(false);
  assert.equal(writes, 1);
  failRead = false;
  await settings.refresh();
  assert.equal(settings.getState().enabled, true);
  assert.equal(settings.getState().phase, "ready");
});

test("a native readback differing from the requested setting is not reported as success", async () => {
  const settings = new AutostartSettings({
    getEnabled: async () => false,
    setEnabled: async () => false,
  }, () => {});

  await settings.refresh();
  await settings.setEnabled(true);
  assert.equal(settings.getState().enabled, false);
  assert.equal(settings.getState().phase, "error");
  assert.match(settings.getState().message, /未生效/);
});

test("focus refreshes and rapid toggle attempts cannot overlap a read or write", async () => {
  const initial = deferred<boolean>();
  const write = deferred<boolean>();
  let reads = 0;
  const writes: boolean[] = [];
  const settings = new AutostartSettings({
    getEnabled: async () => { reads += 1; return initial.promise; },
    setEnabled: async (value) => { writes.push(value); return write.promise; },
  }, () => {});

  const reading = settings.refresh();
  await settings.refresh();
  await settings.setEnabled(true);
  assert.equal(reads, 1);
  assert.deepEqual(writes, []);
  initial.resolve(false);
  await reading;
  const saving = settings.setEnabled(true);
  await settings.setEnabled(true);
  await settings.setEnabled(false);
  await settings.refresh();
  assert.equal(reads, 1);
  assert.deepEqual(writes, [true]);
  write.resolve(true);
  await saving;
  assert.equal(settings.getState().enabled, true);
  assert.equal(settings.getState().phase, "ready");
});

test("an invalid native response cannot be interpreted as a confirmed disabled state", async () => {
  const settings = new AutostartSettings({
    getEnabled: async () => undefined as unknown as boolean,
    setEnabled: async (value) => value,
  }, () => {});

  await settings.refresh();
  assert.equal(settings.getState().enabled, null);
  assert.equal(settings.getState().phase, "error");
});
