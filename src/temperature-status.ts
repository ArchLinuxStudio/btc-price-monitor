export type TemperatureStatus =
  | "available"
  | "driver-missing"
  | "permission-required"
  | "unavailable"
  | "error"
  | "starting"
  | "helper-missing";

export interface TemperatureState {
  cpuStatus: TemperatureStatus;
  memoryStatus: TemperatureStatus;
}

export interface TemperatureStatusView {
  cpu: string;
  memory: string;
  description: string;
}

const labels: Record<TemperatureStatus, string> = {
  available: "已读取",
  "driver-missing": "需要驱动",
  "permission-required": "需要管理员权限",
  unavailable: "未读取到传感器",
  error: "读取失败",
  starting: "正在检测…",
  "helper-missing": "组件缺失",
};

export function normalizeTemperatureState(value: unknown): TemperatureState {
  const record = typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
  const normalize = (status: unknown): TemperatureStatus =>
    typeof status === "string" && Object.prototype.hasOwnProperty.call(labels, status)
      ? status as TemperatureStatus
      : "error";
  return {
    cpuStatus: normalize(record.cpuStatus),
    memoryStatus: normalize(record.memoryStatus),
  };
}

export function temperatureStatusView(state: TemperatureState): TemperatureStatusView {
  const statuses = [state.cpuStatus, state.memoryStatus];
  let description = "温度每秒刷新；内存显示可读取内存条中的最高温度。";
  if (statuses.includes("helper-missing")) {
    description = "温度采集组件缺失，请重新安装完整版本。";
  } else if (statuses.includes("driver-missing")) {
    description = "温度驱动未就绪，请重新运行应用安装程序修复；驱动已包含在安装包中。";
  } else if (statuses.includes("permission-required")) {
    description = "温度访问被拒绝。正式版启动时会请求管理员权限，请允许 Windows 授权。";
  } else if (statuses.includes("error")) {
    description = "温度采集暂时失败，正在重试；其他监控不受影响。";
  } else if (statuses.includes("starting")) {
    description = "正在检测 CPU 和内存温度传感器…";
  } else if (statuses.includes("unavailable")) {
    description = "未读取到温度不代表硬件没有传感器；内存温度取决于内存条和主板支持。";
  }
  return {
    cpu: labels[state.cpuStatus],
    memory: labels[state.memoryStatus],
    description,
  };
}

/** Serializes focus/timer requests; hidden windows make no new IPC calls. */
export class TemperatureStatusReader {
  private busy = false;
  private readonly read: () => Promise<unknown>;
  private readonly visible: () => boolean;
  private readonly publish: (state: TemperatureState) => void;

  constructor(
    read: () => Promise<unknown>,
    visible: () => boolean,
    publish: (state: TemperatureState) => void,
  ) {
    this.read = read;
    this.visible = visible;
    this.publish = publish;
  }

  async refresh(): Promise<void> {
    if (this.busy || !this.visible()) return;
    this.busy = true;
    try {
      const state = normalizeTemperatureState(await this.read());
      if (this.visible()) this.publish(state);
    } catch {
      if (this.visible()) this.publish({ cpuStatus: "error", memoryStatus: "error" });
    } finally {
      this.busy = false;
    }
  }
}
