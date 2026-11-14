use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    Available,
    DriverMissing,
    PermissionRequired,
    Unavailable,
    Error,
    HelperMissing,
    #[default]
    Starting,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemperatureStatus {
    pub cpu_status: Status,
    pub memory_status: Status,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Reading {
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub status: TemperatureStatus,
}

impl Reading {
    fn failed(status: Status) -> Self {
        Self {
            status: TemperatureStatus {
                cpu_status: status,
                memory_status: status,
            },
            ..Self::default()
        }
    }
}

#[derive(Clone, Default)]
pub struct TemperatureMonitor(Arc<Mutex<Option<(Instant, Reading)>>>);

impl TemperatureMonitor {
    pub fn snapshot(&self) -> Reading {
        match self.0.lock().ok().and_then(|value| *value) {
            Some((time, reading)) if time.elapsed() <= Duration::from_secs(3) => reading,
            Some(_) => Reading::failed(Status::Error),
            None => Reading::default(),
        }
    }

    #[cfg(windows)]
    pub fn start(&self, path: std::path::PathBuf) -> std::io::Result<()> {
        let monitor = self.clone();
        std::thread::Builder::new()
            .name("temperature-helper".into())
            .spawn(move || {
                loop {
                    let status = if path.is_file() {
                        Status::Error
                    } else {
                        Status::HelperMissing
                    };
                    if path.is_file() {
                        let _ = run_helper(&path, &monitor);
                    }
                    // No rapid crash loop and no unbounded replacement query threads.
                    for _ in 0..30 {
                        monitor.store(Instant::now(), Reading::failed(status));
                        std::thread::sleep(Duration::from_secs(1));
                    }
                }
            })
            .map(|_| ())
    }

    #[cfg(any(windows, test))]
    fn store(&self, time: Instant, reading: Reading) {
        if let Ok(mut latest) = self.0.lock() {
            *latest = Some((time, reading));
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WireReading {
    sampled_at_ms: u64,
    cpu_temperature_c: Option<f64>,
    memory_temperature_c: Option<f64>,
    cpu_status: Status,
    memory_status: Status,
}

#[cfg(any(windows, test))]
fn decode(line: &str, now_ms: u64) -> Option<Reading> {
    let wire: WireReading = serde_json::from_str(line).ok()?;
    if wire.sampled_at_ms > now_ms.saturating_add(1000)
        || now_ms.saturating_sub(wire.sampled_at_ms) > 3000
    {
        return None;
    }
    let field = |value: Option<f64>, status: Status| {
        let value = value
            .and_then(super::temperature)
            .filter(|_| status == Status::Available);
        (
            value,
            if status == Status::Available && value.is_none() {
                Status::Unavailable
            } else {
                status
            },
        )
    };
    let (cpu, cpu_status) = field(wire.cpu_temperature_c, wire.cpu_status);
    let (memory, memory_status) = field(wire.memory_temperature_c, wire.memory_status);
    Some(Reading {
        cpu,
        memory,
        status: TemperatureStatus {
            cpu_status,
            memory_status,
        },
    })
}

#[cfg(windows)]
fn run_helper(path: &std::path::Path, monitor: &TemperatureMonitor) -> std::io::Result<()> {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::{SystemTime, UNIX_EPOCH};

    let mut child = Command::new(path)
        .current_dir(
            path.parent()
                .ok_or_else(|| std::io::Error::other("missing helper directory"))?,
        )
        .creation_flags(0x08000000) // CREATE_NO_WINDOW; never requests elevation.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;
    let mut input = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let (sender, receiver) = mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        let mut output = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match output.by_ref().take(4097).read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() > 4096 || !line.ends_with('\n') => break,
                Ok(_) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let result = (|| {
        let mut first = true;
        loop {
            let begin = Instant::now();
            input.write_all(b"sample\n")?;
            input.flush()?;
            let line = receiver
                .recv_timeout(Duration::from_secs(if first { 20 } else { 5 }))
                .map_err(|_| std::io::Error::other("temperature helper stopped responding"))?;
            first = false;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let reading = decode(&line, now).unwrap_or_else(|| Reading::failed(Status::Error));
            monitor.store(begin, reading);
            std::thread::sleep(Duration::from_secs(1).saturating_sub(begin.elapsed()));
        }
    })();
    drop(input);
    let _ = child.kill();
    let _ = child.wait();
    drop(receiver);
    let _ = reader.join();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_stale_invalid_and_permission_denied_values() {
        let line = r#"{"sampledAtMs":10000,"cpuTemperatureC":52,"memoryTemperatureC":900,"cpuStatus":"available","memoryStatus":"available"}"#;
        let reading = decode(line, 11000).unwrap();
        assert_eq!(reading.cpu, Some(52.0));
        assert_eq!(reading.memory, None);
        assert_eq!(reading.status.memory_status, Status::Unavailable);
        assert!(decode(line, 14000).is_none());
        assert!(decode(line, 8000).is_none());
        assert!(decode("bad json", 11000).is_none());
        assert_eq!(
            decode(&line.replace("available", "permission-required"), 11000)
                .unwrap()
                .cpu,
            None
        );
    }

    #[test]
    fn stalled_helper_expires_independently_of_base_metrics() {
        let monitor = TemperatureMonitor::default();
        assert_eq!(monitor.snapshot().status.cpu_status, Status::Starting);
        monitor.store(
            Instant::now(),
            Reading {
                cpu: Some(45.0),
                ..Reading::default()
            },
        );
        assert_eq!(monitor.snapshot().cpu, Some(45.0));
        monitor.store(
            Instant::now() - Duration::from_secs(4),
            Reading {
                cpu: Some(45.0),
                ..Reading::default()
            },
        );
        assert_eq!(monitor.snapshot().cpu, None);
        assert_eq!(monitor.snapshot().status.cpu_status, Status::Error);
    }
}
