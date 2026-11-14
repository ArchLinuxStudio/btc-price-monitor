use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{MemoryRefreshKind, Networks, System};

mod gpu;
mod sensors;
mod temperature_bridge;
pub use temperature_bridge::{Status as TemperatureSourceStatus, TemperatureStatus};

const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub sampled_at_ms: u64,
    pub upload_bytes_per_second: Option<f64>,
    pub download_bytes_per_second: Option<f64>,
    pub cpu_usage_percent: Option<f64>,
    pub cpu_temperature_c: Option<f64>,
    pub memory_usage_percent: Option<f64>,
    pub memory_temperature_c: Option<f64>,
    pub gpu_usage_percent: Option<f64>,
    pub gpu_temperature_c: Option<f64>,
}

#[derive(Clone, Default)]
pub struct SystemMetricsState {
    latest: Arc<Mutex<SystemMetrics>>,
    started: Arc<AtomicBool>,
    temperatures: temperature_bridge::TemperatureMonitor,
}

impl SystemMetricsState {
    pub fn temperature_status(&self) -> Result<TemperatureStatus, String> {
        let sample = self.snapshot()?;
        let mut status = self.temperatures.snapshot().status;
        let fresh = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .saturating_sub(u128::from(sample.sampled_at_ms))
            <= 3000;
        if fresh && sample.cpu_temperature_c.is_some() {
            status.cpu_status = TemperatureSourceStatus::Available;
        }
        if fresh && sample.memory_temperature_c.is_some() {
            status.memory_status = TemperatureSourceStatus::Available;
        }
        #[cfg(not(windows))]
        {
            if status.cpu_status != TemperatureSourceStatus::Available {
                status.cpu_status = TemperatureSourceStatus::Unavailable;
            }
            if status.memory_status != TemperatureSourceStatus::Available {
                status.memory_status = TemperatureSourceStatus::Unavailable;
            }
        }
        Ok(status)
    }

    pub fn snapshot(&self) -> Result<SystemMetrics, String> {
        self.latest
            .lock()
            .map(|sample| sample.clone())
            .map_err(|_| "system metrics are unavailable".to_owned())
    }
}

/// Starts one process-lifetime sampler. IPC only reads the latest cached sample.
pub fn start(state: &SystemMetricsState, helper_path: std::path::PathBuf) -> std::io::Result<()> {
    if state.started.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let latest = Arc::clone(&state.latest);
    #[cfg(windows)]
    if let Err(error) = state.temperatures.start(helper_path) {
        state.started.store(false, Ordering::Release);
        return Err(error);
    }
    #[cfg(not(windows))]
    let _ = helper_path;
    let temperatures = state.temperatures.clone();
    let result = std::thread::Builder::new()
        .name("system-metrics".into())
        .spawn(move || {
            let mut sampler = Sampler::new(temperatures);
            let mut deadline = Instant::now() + SAMPLE_INTERVAL;
            loop {
                std::thread::sleep(deadline.saturating_duration_since(Instant::now()));
                let sample = sampler.sample();
                if let Ok(mut current) = latest.lock() {
                    *current = sample;
                }
                deadline += SAMPLE_INTERVAL;
                // Slow APIs never cause overlapping work or a burst of catch-up samples.
                if deadline <= Instant::now() {
                    deadline = Instant::now() + SAMPLE_INTERVAL;
                }
            }
        });
    if let Err(error) = result {
        state.started.store(false, Ordering::Release);
        return Err(error);
    }
    Ok(())
}

struct Sampler {
    system: System,
    networks: Networks,
    previous_networks: HashMap<String, NetworkTotals>,
    previous_sample: Instant,
    gpu: gpu::GpuSampler,
    sensors: sensors::Sensors,
    temperatures: temperature_bridge::TemperatureMonitor,
}

impl Sampler {
    fn new(temperatures: temperature_bridge::TemperatureMonitor) -> Self {
        let mut system = System::new();
        system.refresh_cpu_usage();
        let networks = Networks::new_with_refreshed_list();
        let previous_networks = network_totals(&networks);
        Self {
            system,
            networks,
            previous_networks,
            previous_sample: Instant::now(),
            gpu: gpu::GpuSampler::new(),
            sensors: sensors::Sensors::new(),
            temperatures,
        }
    }

    fn sample(&mut self) -> SystemMetrics {
        // A slow optional sensor must not make earlier readings appear fresh.
        let sampled_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as u64)
            .unwrap_or(0);
        self.system.refresh_cpu_usage();
        self.system
            .refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        self.networks.refresh(true);
        let now = Instant::now();
        let elapsed = now.duration_since(self.previous_sample).as_secs_f64();
        let totals = network_totals(&self.networks);
        let upload = network_rate(&self.previous_networks, &totals, elapsed, |totals| {
            totals.transmitted
        });
        let download = network_rate(&self.previous_networks, &totals, elapsed, |totals| {
            totals.received
        });
        self.previous_networks = totals;
        self.previous_sample = now;
        let sensor_values = self.sensors.sample();
        let temperatures = self.temperatures.snapshot();
        let native_gpu = self.gpu.sample();
        // Do not combine utilization from one adapter with another adapter's temperature.
        let (gpu_usage, gpu_temperature) = if native_gpu.0.is_some() || native_gpu.1.is_some() {
            native_gpu
        } else {
            (sensor_values.gpu_usage, sensor_values.gpu_temperature)
        };
        SystemMetrics {
            sampled_at_ms,
            upload_bytes_per_second: upload,
            download_bytes_per_second: download,
            cpu_usage_percent: if self.system.cpus().is_empty() {
                None
            } else {
                percent(f64::from(self.system.global_cpu_usage()))
            },
            memory_usage_percent: memory_percent(
                self.system.used_memory(),
                self.system.total_memory(),
            ),
            cpu_temperature_c: temperatures.cpu.or(sensor_values.cpu_temperature),
            memory_temperature_c: temperatures.memory.or(sensor_values.memory_temperature),
            gpu_usage_percent: gpu_usage,
            gpu_temperature_c: gpu_temperature,
        }
    }
}

struct NetworkTotals {
    transmitted: u64,
    received: u64,
}

fn network_totals(networks: &Networks) -> HashMap<String, NetworkTotals> {
    networks
        .iter()
        .filter(|(name, network)| {
            let name = name.to_ascii_lowercase();
            name != "lo"
                && name != "lo0"
                && !name.contains("loopback")
                && !network.ip_networks().iter().all(|ip| ip.addr.is_loopback())
        })
        .map(|(name, network)| {
            (
                name.clone(),
                NetworkTotals {
                    transmitted: network.total_transmitted(),
                    received: network.total_received(),
                },
            )
        })
        .collect()
}

fn network_rate(
    previous: &HashMap<String, NetworkTotals>,
    current: &HashMap<String, NetworkTotals>,
    seconds: f64,
    counter: fn(&NetworkTotals) -> u64,
) -> Option<f64> {
    if !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }
    let mut bytes = 0_u64;
    let mut known = false;
    for (name, value) in current {
        // Each direction has its own reset/availability state, but both use
        // the same interfaces and elapsed sample interval.
        if let Some(delta) = previous
            .get(name)
            .and_then(|old| counter(value).checked_sub(counter(old)))
        {
            bytes = bytes.saturating_add(delta);
            known = true;
        }
    }
    known.then_some(bytes as f64 / seconds)
}

fn percent(value: f64) -> Option<f64> {
    value.is_finite().then(|| value.clamp(0.0, 100.0))
}

fn memory_percent(used: u64, total: u64) -> Option<f64> {
    if total == 0 {
        None
    } else {
        percent(used as f64 / total as f64 * 100.0)
    }
}

fn temperature(value: f64) -> Option<f64> {
    (value.is_finite() && (-20.0..=150.0).contains(&value)).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counters(items: &[(&str, u64, u64)]) -> HashMap<String, NetworkTotals> {
        items
            .iter()
            .map(|(key, transmitted, received)| {
                (
                    (*key).to_owned(),
                    NetworkTotals {
                        transmitted: *transmitted,
                        received: *received,
                    },
                )
            })
            .collect()
    }

    #[test]
    fn network_uses_real_elapsed_time_and_ignores_new_reset_or_removed_interfaces() {
        let old = counters(&[
            ("ethernet", 200, 100),
            ("reset-receive", 500, 200),
            ("reset-transmit", 400, 1000),
            ("removed", 800, 600),
        ]);
        let new = counters(&[
            ("ethernet", 400, 1100),
            ("reset-receive", 700, 50),
            ("reset-transmit", 50, 1400),
            ("new", 999999, 999999),
        ]);
        let transmitted = |totals: &NetworkTotals| totals.transmitted;
        let received = |totals: &NetworkTotals| totals.received;
        assert_eq!(network_rate(&old, &new, 2.0, transmitted), Some(200.0));
        assert_eq!(network_rate(&old, &new, 2.0, received), Some(700.0));
        for counter in [transmitted as fn(&NetworkTotals) -> u64, received] {
            assert_eq!(network_rate(&new, &new, 1.0, counter), Some(0.0));
            assert_eq!(network_rate(&HashMap::new(), &new, 1.0, counter), None);
            assert_eq!(network_rate(&old, &HashMap::new(), 1.0, counter), None);
            assert_eq!(network_rate(&old, &new, 0.0, counter), None);
            assert_eq!(network_rate(&old, &new, f64::NAN, counter), None);
        }
    }

    #[test]
    fn a_counter_reset_does_not_hide_the_other_direction() {
        let old = counters(&[("ethernet", 100, 200)]);
        let new = counters(&[("ethernet", 50, 500)]);
        assert_eq!(network_rate(&old, &new, 1.0, |t| t.transmitted), None);
        assert_eq!(network_rate(&old, &new, 1.0, |t| t.received), Some(300.0));
        let new = counters(&[("ethernet", 400, 50)]);
        assert_eq!(
            network_rate(&old, &new, 1.0, |t| t.transmitted),
            Some(300.0)
        );
        assert_eq!(network_rate(&old, &new, 1.0, |t| t.received), None);
    }

    #[test]
    fn unsupported_invalid_and_zero_readings_remain_distinct() {
        assert_eq!(memory_percent(500, 1000), Some(50.0));
        assert_eq!(memory_percent(0, 0), None);
        assert_eq!(percent(0.0), Some(0.0));
        assert_eq!(percent(f64::NAN), None);
        assert_eq!(temperature(0.0), Some(0.0));
        assert_eq!(temperature(273.15), None);
        let snapshot = SystemMetricsState::default().snapshot().unwrap();
        assert_eq!(snapshot.sampled_at_ms, 0);
        assert_eq!(snapshot.upload_bytes_per_second, None);
        assert_eq!(snapshot.download_bytes_per_second, None);
        assert_eq!(snapshot.cpu_usage_percent, None);
    }

    #[test]
    #[ignore = "read-only hardware sampling, run explicitly without starting a desktop window"]
    fn live_sample_read_only() {
        let mut sampler = Sampler::new(temperature_bridge::TemperatureMonitor::default());
        for _ in 0..3 {
            std::thread::sleep(SAMPLE_INTERVAL);
            println!("{}", serde_json::to_string(&sampler.sample()).unwrap());
        }
    }
}
