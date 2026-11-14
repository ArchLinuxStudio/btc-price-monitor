//! Current-user login registration. Existing Windows opt-ins can migrate on upgrade.
use std::path::PathBuf;

use tauri::AppHandle;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use tauri::Manager;

use super::AutostartBackend;

#[cfg(any(windows, test))]
#[path = "windows_task.rs"]
mod windows_task;

#[cfg(any(target_os = "linux", target_os = "macos", test))]
const ENTRY_ID: &str = "com.cryptotop.monitor";

pub(super) struct SystemAutostart {
    executable: PathBuf,
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    entry: PathBuf,
}

impl SystemAutostart {
    pub(super) fn migrate_existing(&self) -> Result<(), String> {
        #[cfg(windows)]
        windows_task::run(windows_task::Operation::Migrate, &self.executable)?;
        Ok(())
    }

    pub(super) fn new(_app: &AppHandle) -> Result<Self, String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        #[cfg(target_os = "linux")]
        let executable = _app.env().appimage.unwrap_or(executable);
        #[cfg(target_os = "linux")]
        let entry = _app
            .path()
            .config_dir()
            .map_err(|error| error.to_string())?
            .join("autostart")
            .join(format!("{ENTRY_ID}.desktop"));
        #[cfg(target_os = "macos")]
        let entry = _app
            .path()
            .home_dir()
            .map_err(|error| error.to_string())?
            .join("Library/LaunchAgents")
            .join(format!("{ENTRY_ID}.plist"));
        Ok(Self {
            executable,
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            entry,
        })
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn executable_text(&self) -> Result<&str, String> {
        self.executable
            .to_str()
            .ok_or_else(|| "startup executable path is not valid Unicode".to_owned())
    }
}

#[cfg(windows)]
impl AutostartBackend for SystemAutostart {
    fn is_enabled(&self) -> Result<bool, String> {
        windows_task::run(windows_task::Operation::Query, &self.executable)
    }

    fn enable(&self) -> Result<(), String> {
        windows_task::run(windows_task::Operation::Enable, &self.executable).map(|_| ())
    }

    fn disable(&self) -> Result<(), String> {
        windows_task::run(windows_task::Operation::Disable, &self.executable).map(|_| ())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
impl AutostartBackend for SystemAutostart {
    fn is_enabled(&self) -> Result<bool, String> {
        let Some(bytes) = read_registration(&self.entry)? else {
            return Ok(false);
        };
        #[cfg(target_os = "linux")]
        {
            desktop_enabled(&bytes)
        }
        #[cfg(target_os = "macos")]
        {
            launch_agent_enabled(&bytes)
        }
    }

    fn enable(&self) -> Result<(), String> {
        #[cfg(target_os = "linux")]
        let bytes = desktop_entry(self.executable_text()?)?.into_bytes();
        #[cfg(target_os = "macos")]
        let bytes = launch_agent(self.executable_text()?)?;
        write_registration(&self.entry, &bytes)
    }

    fn disable(&self) -> Result<(), String> {
        ignore_missing(std::fs::remove_file(&self.entry))
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", test))]
fn ignore_missing(result: std::io::Result<()>) -> Result<(), String> {
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(any(target_os = "linux", test))]
fn desktop_entry(path: &str) -> Result<String, String> {
    // Exec is a desktop-entry command, not a shell command. Reject characters
    // that cannot be represented portably and apply both string and Exec escapes.
    if path.is_empty() || path.contains('=') || path.chars().any(char::is_control) {
        return Err("startup executable path cannot be represented in a desktop entry".to_owned());
    }
    let mut quoted = String::from("\"");
    for ch in path.chars() {
        match ch {
            '\\' => quoted.push_str(r"\\\\"),
            '"' | '$' | '`' => {
                quoted.push_str(r"\\");
                quoted.push(ch);
            }
            '%' => quoted.push_str("%%"),
            _ => quoted.push(ch),
        }
    }
    quoted.push('"');
    Ok(format!("[Desktop Entry]\nType=Application\nVersion=1.0\nName=Crypto Top\nExec={quoted}\nTerminal=false\nStartupNotify=false\n"))
}

#[cfg(any(target_os = "linux", test))]
fn desktop_enabled(bytes: &[u8]) -> Result<bool, String> {
    let text = std::str::from_utf8(bytes).map_err(|error| error.to_string())?;
    let mut in_entry = false;
    let mut executable = false;
    let mut application = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        match (key.trim(), value.trim()) {
            ("Hidden", "true") | ("X-GNOME-Autostart-enabled", "false") => return Ok(false),
            ("Type", "Application") => application = true,
            ("Exec", value) if !value.is_empty() => executable = true,
            _ => {}
        }
    }
    if application && executable {
        Ok(true)
    } else {
        Err("startup desktop entry is invalid".to_owned())
    }
}

#[cfg(any(target_os = "macos", test))]
fn launch_agent(path: &str) -> Result<Vec<u8>, String> {
    if path.is_empty() || path.chars().any(char::is_control) {
        return Err("startup executable path cannot be represented in a LaunchAgent".to_owned());
    }
    let mut values = plist::Dictionary::new();
    values.insert("Label".into(), ENTRY_ID.into());
    values.insert(
        "ProgramArguments".into(),
        plist::Value::Array(vec![path.into()]),
    );
    values.insert("RunAtLoad".into(), true.into());
    let mut bytes = Vec::new();
    plist::Value::Dictionary(values)
        .to_writer_xml(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

#[cfg(any(target_os = "macos", test))]
fn launch_agent_enabled(bytes: &[u8]) -> Result<bool, String> {
    let value = plist::Value::from_reader(std::io::Cursor::new(bytes))
        .map_err(|error| error.to_string())?;
    let fields = value
        .as_dictionary()
        .ok_or("startup LaunchAgent is invalid")?;
    if fields.get("Disabled").and_then(plist::Value::as_boolean) == Some(true) {
        return Ok(false);
    }
    if fields.get("Label").and_then(plist::Value::as_string) != Some(ENTRY_ID)
        || fields.get("RunAtLoad").and_then(plist::Value::as_boolean) != Some(true)
        || fields
            .get("ProgramArguments")
            .and_then(plist::Value::as_array)
            .and_then(|args| args.first())
            .and_then(plist::Value::as_string)
            .is_none_or(str::is_empty)
    {
        return Err("startup LaunchAgent is invalid".to_owned());
    }
    Ok(true)
}

#[cfg(any(target_os = "linux", target_os = "macos", test))]
fn read_registration(path: &std::path::Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(any(target_os = "linux", target_os = "macos", test))]
fn write_registration(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let parent = path.parent().ok_or("startup directory is unavailable")?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| error.to_string())?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_exec_quotes_spaces_and_escapes_reserved_characters() {
        let entry = desktop_entry("/home/用户/Crypto Top/$cash`\"\\%f.AppImage").unwrap();
        assert!(entry.contains(r#"Exec="/home/用户/Crypto Top/\\$cash\\`\\"\\\\%%f.AppImage""#));
        assert!(desktop_enabled(entry.as_bytes()).unwrap());
        assert!(desktop_entry("/tmp/evil\nHidden=false").is_err());
        assert!(desktop_entry("/tmp/a=b.AppImage").is_err());
    }

    #[test]
    fn desktop_disabled_and_malformed_entries_are_distinct() {
        let entry = desktop_entry("/opt/Crypto Top.AppImage").unwrap();
        assert!(!desktop_enabled(format!("{entry}Hidden=true\n").as_bytes()).unwrap());
        assert!(
            !desktop_enabled(format!("{entry}X-GNOME-Autostart-enabled=false\n").as_bytes())
                .unwrap()
        );
        assert!(desktop_enabled(b"garbage").is_err());
        assert!(desktop_enabled(b"[Desktop Entry]\nType=Application\n").is_err());
    }

    #[test]
    fn launch_agent_preserves_special_characters_as_one_argument() {
        let path = "/Applications/Crypto & <Top> \"测试\".app/Contents/MacOS/crypto-top";
        let bytes = launch_agent(path).unwrap();
        assert!(launch_agent_enabled(&bytes).unwrap());
        let value = plist::Value::from_reader(std::io::Cursor::new(bytes)).unwrap();
        let fields = value.as_dictionary().unwrap();
        assert_eq!(
            fields["ProgramArguments"].as_array().unwrap(),
            &[plist::Value::String(path.into())]
        );
        assert!(launch_agent_enabled(b"partial XML").is_err());
        let mut fields = fields.clone();
        fields.insert("Disabled".into(), true.into());
        let mut bytes = Vec::new();
        plist::Value::Dictionary(fields)
            .to_writer_xml(&mut bytes)
            .unwrap();
        assert!(!launch_agent_enabled(&bytes).unwrap());
    }

    #[test]
    fn registration_files_are_written_completely_and_read_errors_are_not_disabled() {
        let dir = std::env::temp_dir().join(format!(
            "crypto-top-autostart-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let entry = dir.join("nested/test.desktop");
        assert_eq!(read_registration(&entry).unwrap(), None);
        let bytes = desktop_entry("/opt/Crypto Top.AppImage")
            .unwrap()
            .into_bytes();
        write_registration(&entry, &bytes).unwrap();
        assert_eq!(read_registration(&entry).unwrap(), Some(bytes));
        assert!(read_registration(entry.parent().unwrap()).is_err());
        ignore_missing(std::fs::remove_file(&entry)).unwrap();
        ignore_missing(std::fs::remove_file(&entry)).unwrap();
        std::fs::remove_dir(entry.parent().unwrap()).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
