#[cfg(any(windows, test))]
use super::percent;
use super::temperature;

#[derive(Clone, Copy, Default)]
pub(super) struct SensorValues {
    pub cpu_temperature: Option<f64>,
    pub memory_temperature: Option<f64>,
    pub gpu_usage: Option<f64>,
    pub gpu_temperature: Option<f64>,
}

fn highest(current: Option<f64>, next: Option<f64>) -> Option<f64> {
    match (current, next) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (value, None) | (None, value) => value,
    }
}

#[cfg(not(windows))]
pub(super) struct Sensors;

#[cfg(not(windows))]
impl Sensors {
    pub(super) fn new() -> Self {
        Self
    }

    pub(super) fn sample(&mut self) -> SensorValues {
        let mut values = SensorValues::default();
        // Recreate the read-only list so a disappeared/failed sensor cannot retain
        // its last cached temperature indefinitely.
        for component in &sysinfo::Components::new_with_refreshed_list() {
            let value = component
                .temperature()
                .and_then(|value| temperature(f64::from(value)));
            match component_kind(component.label(), component.id()) {
                Some("cpu") => values.cpu_temperature = highest(values.cpu_temperature, value),
                Some("memory") => {
                    values.memory_temperature = highest(values.memory_temperature, value)
                }
                Some("gpu") => values.gpu_temperature = highest(values.gpu_temperature, value),
                _ => {}
            }
        }
        values
    }
}

#[cfg(any(not(windows), test))]
fn component_kind(label: &str, id: Option<&str>) -> Option<&'static str> {
    let label = label.to_ascii_lowercase();
    let id = id.unwrap_or_default().to_ascii_uppercase();
    if label.contains("coretemp")
        || label.contains("k10temp")
        || label.contains("zenpower")
        || label.starts_with("cpu ")
        || label.starts_with("cpu_")
        || matches!(id.as_str(), "TC0P" | "TCXC")
    {
        Some("cpu")
    } else if label.contains("jc42")
        || label.contains("spd5118")
        || label.starts_with("dimm ")
        || label.starts_with("ram ")
    {
        Some("memory")
    } else if label.contains("amdgpu") || label.starts_with("gpu ") || id == "TG0P" {
        Some("gpu")
    } else {
        None
    }
}

#[cfg(windows)]
pub(super) struct Sensors {
    cache: std::sync::Arc<std::sync::Mutex<Option<(std::time::Instant, SensorValues)>>>,
}

#[cfg(windows)]
impl Sensors {
    pub(super) fn new() -> Self {
        use std::{
            sync::{Arc, Mutex},
            time::{Duration, Instant},
        };
        let cache = Arc::new(Mutex::new(None));
        let output = Arc::clone(&cache);
        // Optional third-party WMI providers can stall. Keep them off the basic
        // CPU/memory/network/NVML sampler; allow only one query worker, never a
        // replacement worker for a hung query, and expire its cached readings.
        let _ = std::thread::Builder::new()
            .name("hardware-sensors".into())
            .spawn(move || {
                let mut connection = None;
                let mut last_attempt = Instant::now() - Duration::from_secs(30);
                loop {
                    let begin = Instant::now();
                    if connection.is_none() && last_attempt.elapsed() >= Duration::from_secs(30) {
                        last_attempt = Instant::now();
                        connection =
                            wmi::WMIConnection::with_namespace_path("ROOT\\LibreHardwareMonitor")
                                .or_else(|_| {
                                    wmi::WMIConnection::with_namespace_path(
                                        "ROOT\\OpenHardwareMonitor",
                                    )
                                })
                                .ok();
                    }
                    let values = match connection.as_ref().map(read_wmi) {
                        Some(Ok(values)) => values,
                        Some(Err(_)) => {
                            connection = None;
                            SensorValues::default()
                        }
                        None => SensorValues::default(),
                    };
                    if let Ok(mut latest) = output.lock() {
                        *latest = Some((begin, values));
                    }
                    std::thread::sleep(Duration::from_secs(1).saturating_sub(begin.elapsed()));
                }
            });
        Self { cache }
    }

    pub(super) fn sample(&mut self) -> SensorValues {
        self.cache
            .lock()
            .ok()
            .and_then(|cache| *cache)
            .filter(|(time, _)| time.elapsed() <= std::time::Duration::from_secs(3))
            .map(|(_, values)| values)
            .unwrap_or_default()
    }
}

#[cfg(any(windows, test))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Hardware {
    identifier: String,
    hardware_type: String,
}

#[cfg(any(windows, test))]
#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Sensor {
    #[serde(default)]
    identifier: String,
    parent: String,
    name: String,
    sensor_type: String,
    value: Option<f64>,
}

#[cfg(windows)]
fn read_wmi(connection: &wmi::WMIConnection) -> wmi::WMIResult<SensorValues> {
    let hardware: Vec<Hardware> =
        connection.raw_query("SELECT Identifier, HardwareType FROM Hardware")?;
    let sensors: Vec<Sensor> = connection.raw_query(
        "SELECT Identifier, Parent, Name, SensorType, Value FROM Sensor WHERE SensorType = 'Temperature' OR SensorType = 'Load'"
    )?;
    Ok(map_hardware_sensors(&hardware, &sensors))
}

#[cfg(any(windows, test))]
fn map_hardware_sensors(hardware: &[Hardware], sensors: &[Sensor]) -> SensorValues {
    use std::collections::HashMap;
    let kinds: HashMap<_, _> = hardware
        .iter()
        .map(|item| {
            (
                item.identifier.as_str(),
                item.hardware_type.to_ascii_lowercase(),
            )
        })
        .collect();
    let mut gpu_values: HashMap<&str, (Option<f64>, Option<f64>)> = HashMap::new();
    let mut result = SensorValues::default();
    for sensor in sensors {
        let Some(kind) = kinds.get(sensor.parent.as_str()) else {
            continue;
        };
        let Some(value) = sensor.value else {
            continue;
        };
        if sensor.sensor_type == "Temperature" {
            let temp = temperature(value);
            match kind.as_str() {
                "cpu" if !sensor.name.to_ascii_lowercase().contains("distance") => {
                    result.cpu_temperature = highest(result.cpu_temperature, temp)
                }
                "memory"
                    if sensor.parent.starts_with("/memory/dimm/")
                        && sensor.identifier.ends_with("/temperature/0") =>
                {
                    result.memory_temperature = highest(result.memory_temperature, temp)
                }
                "gpunvidia" | "gpuamd" | "gpuintel" if sensor.name == "GPU Core" => {
                    gpu_values.entry(&sensor.parent).or_default().1 = temp;
                }
                _ => {}
            }
        } else if sensor.sensor_type == "Load"
            && sensor.name == "GPU Core"
            && matches!(kind.as_str(), "gpunvidia" | "gpuamd" | "gpuintel")
        {
            gpu_values.entry(&sensor.parent).or_default().0 = percent(value);
        }
    }
    if let Some((usage, temp)) = gpu_values
        .values()
        .max_by(|a, b| a.0.unwrap_or(-1.0).total_cmp(&b.0.unwrap_or(-1.0)))
    {
        result.gpu_usage = *usage;
        result.gpu_temperature = *temp;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_classification_rejects_acpi_board_disk_and_gpu_memory_as_ram() {
        assert_eq!(component_kind("coretemp Package id 0", None), Some("cpu"));
        assert_eq!(component_kind("jc42 DIMM 0", None), Some("memory"));
        assert_eq!(component_kind("CPU Proximity", Some("TC0P")), Some("cpu"));
        assert_eq!(component_kind("PECI CPU", Some("TCXc")), Some("cpu"));
        for label in [
            "Computer",
            "acpitz temp1",
            "nvme composite",
            "Mainboard",
            "GPU Memory",
        ] {
            assert_ne!(component_kind(label, None), Some("memory"));
            assert_ne!(component_kind(label, None), Some("cpu"));
        }
    }

    #[test]
    fn hardware_mapping_uses_device_type_and_keeps_gpu_metrics_on_same_adapter() {
        let hardware = vec![
            Hardware {
                identifier: "cpu".into(),
                hardware_type: "Cpu".into(),
            },
            Hardware {
                identifier: "/memory/dimm/0".into(),
                hardware_type: "Memory".into(),
            },
            Hardware {
                identifier: "board".into(),
                hardware_type: "Motherboard".into(),
            },
            Hardware {
                identifier: "gpu0".into(),
                hardware_type: "GpuNvidia".into(),
            },
            Hardware {
                identifier: "gpu1".into(),
                hardware_type: "GpuIntel".into(),
            },
        ];
        let sensor = |parent: &str, name: &str, kind: &str, value: f64| Sensor {
            identifier: format!("{parent}/temperature/0"),
            parent: parent.into(),
            name: name.into(),
            sensor_type: kind.into(),
            value: Some(value),
        };
        let sensors = vec![
            sensor("cpu", "CPU Package", "Temperature", 45.0),
            sensor("cpu", "CPU Core #1", "Temperature", 51.0),
            sensor("board", "CPU", "Temperature", 99.0),
            sensor("/memory/dimm/0", "DIMM #0", "Temperature", 33.0),
            Sensor {
                identifier: "/memory/dimm/0/temperature/3".into(),
                ..sensor(
                    "/memory/dimm/0",
                    "Thermal Sensor High Limit",
                    "Temperature",
                    95.0,
                )
            },
            sensor("cpu", "Distance to TjMax", "Temperature", 80.0),
            sensor("gpu0", "GPU Memory", "Temperature", 90.0),
            sensor("gpu0", "GPU Core", "Temperature", 48.0),
            sensor("gpu0", "GPU Core", "Load", 50.0),
            sensor("gpu1", "GPU Core", "Temperature", 60.0),
            sensor("gpu1", "GPU Core", "Load", 10.0),
        ];
        let values = map_hardware_sensors(&hardware, &sensors);
        assert_eq!(values.cpu_temperature, Some(51.0));
        assert_eq!(values.memory_temperature, Some(33.0));
        assert_eq!(values.gpu_usage, Some(50.0));
        assert_eq!(values.gpu_temperature, Some(48.0));
    }
}
