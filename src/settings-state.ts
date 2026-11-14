export interface AutostartApi {
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
}

export interface AutostartState {
  readonly enabled: boolean | null;
  readonly phase: "loading" | "saving" | "ready" | "error";
  readonly message: string;
}

function confirmedState(value: boolean): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Invalid autostart state");
  }
  return value;
}

export class AutostartSettings {
  private state: AutostartState = {
    enabled: null,
    phase: "loading",
    message: "正在读取开机启动设置…",
  };
  private busy = false;
  private readonly api: AutostartApi;
  private readonly onChange: (state: AutostartState) => void;

  constructor(
    api: AutostartApi,
    onChange: (state: AutostartState) => void,
  ) {
    this.api = api;
    this.onChange = onChange;
  }

  getState(): AutostartState {
    return this.state;
  }

  private publish(state: AutostartState): void {
    this.state = state;
    this.onChange(state);
  }

  async refresh(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.publish({ ...this.state, phase: "loading", message: "正在读取开机启动设置…" });
    try {
      const enabled = confirmedState(await this.api.getEnabled());
      this.publish({ enabled, phase: "ready", message: "更改后立即生效" });
    } catch {
      this.publish({ enabled: null, phase: "error", message: "无法读取开机启动状态，请重试。" });
    } finally {
      this.busy = false;
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (this.busy || this.state.enabled === null || enabled === this.state.enabled) {
      return;
    }
    this.busy = true;
    this.publish({ ...this.state, phase: "saving", message: "正在保存…" });
    try {
      const actual = confirmedState(await this.api.setEnabled(enabled));
      this.publish({
        enabled: actual,
        phase: actual === enabled ? "ready" : "error",
        message: actual === enabled
          ? (actual ? "已开启开机自动启动" : "已关闭开机自动启动")
          : "设置未生效，请重试。",
      });
    } catch {
      // A native write may have succeeded before its readback failed. Read again
      // instead of displaying an optimistic or potentially stale checkbox value.
      let actual: boolean | null = null;
      try {
        actual = confirmedState(await this.api.getEnabled());
      } catch {
        // Unknown remains distinct from a confirmed disabled setting.
      }
      this.publish({
        enabled: actual,
        phase: "error",
        message: actual === null
          ? "无法确认开机启动状态，请重新读取。"
          : "保存时发生错误，已重新读取当前状态。",
      });
    } finally {
      this.busy = false;
    }
  }
}
