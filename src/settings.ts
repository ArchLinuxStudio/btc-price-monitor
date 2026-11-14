import { AutostartSettings, type AutostartState } from "./settings-state.js";
import { TemperatureStatusReader, temperatureStatusView, type TemperatureState } from "./temperature-status.js";

interface SettingsTauriApi {
  core?: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  };
}

type SettingsGlobal = typeof globalThis & { __TAURI__?: SettingsTauriApi };

const autostartToggle = document.querySelector<HTMLInputElement>("#autostart-toggle")!;
const settingsStatus = document.querySelector<HTMLParagraphElement>("#settings-status")!;
const retryButton = document.querySelector<HTMLButtonElement>("#retry-settings")!;
const settingsCard = document.querySelector<HTMLElement>("#general-settings")!;
const cpuTemperatureStatus = document.querySelector<HTMLElement>("#cpu-temperature-status")!;
const memoryTemperatureStatus = document.querySelector<HTMLElement>("#memory-temperature-status")!;
const temperatureDescription = document.querySelector<HTMLElement>("#temperature-description")!;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const core = (globalThis as SettingsGlobal).__TAURI__?.core;
  if (typeof core?.invoke !== "function") {
    throw new Error("Settings are only available in the desktop app");
  }
  return core.invoke<T>(command, args);
}

function render(state: AutostartState): void {
  const busy = state.phase === "loading" || state.phase === "saving";
  autostartToggle.checked = state.enabled === true;
  autostartToggle.indeterminate = state.enabled === null;
  autostartToggle.disabled = busy || state.enabled === null;
  settingsCard.setAttribute("aria-busy", String(busy));
  settingsStatus.textContent = state.message;
  settingsStatus.classList.toggle("is-error", state.phase === "error");
  retryButton.hidden = state.phase !== "error";
  retryButton.disabled = busy;
}

const settings = new AutostartSettings({
  getEnabled: () => invoke("get_autostart_enabled"),
  setEnabled: (enabled) => invoke("set_autostart_enabled", { enabled }),
}, render);

function renderTemperature(state: TemperatureState): void {
  const view = temperatureStatusView(state);
  cpuTemperatureStatus.textContent = view.cpu;
  memoryTemperatureStatus.textContent = view.memory;
  temperatureDescription.textContent = view.description;
}

const temperatures = new TemperatureStatusReader(
  () => invoke<unknown>("get_temperature_status"),
  () => document.visibilityState === "visible",
  renderTemperature,
);

autostartToggle.addEventListener("change", () => {
  const requested = autostartToggle.checked;
  // Keep the last confirmed state visible until the system accepts the change.
  render(settings.getState());
  void settings.setEnabled(requested);
});
retryButton.addEventListener("click", () => void settings.refresh());
window.addEventListener("focus", () => {
  void settings.refresh();
  void temperatures.refresh();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void settings.refresh();
    void temperatures.refresh();
  }
});
for (const eventName of ["dragover", "drop"]) {
  window.addEventListener(eventName, (event) => event.preventDefault());
}

render(settings.getState());
void settings.refresh();
void temperatures.refresh();
window.setInterval(() => void temperatures.refresh(), 1_000);
