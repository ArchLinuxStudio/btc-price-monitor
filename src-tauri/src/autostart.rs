use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewWindow};

mod registration;
use registration::SystemAutostart;

#[derive(Default)]
pub struct AutostartAccess(Mutex<()>);

/// Preserve an existing login preference when upgrading the Windows backend.
/// Never enables startup for a user who did not already opt in.
pub fn migrate_existing(app: AppHandle) {
    #[cfg(windows)]
    tauri::async_runtime::spawn_blocking(move || {
        let access = app.state::<AutostartAccess>();
        if let Ok(_guard) = access.0.lock() {
            // A failed migration remains visible through the settings readback;
            // it must not prevent the monitor itself from opening.
            let _ = SystemAutostart::new(&app).and_then(|backend| backend.migrate_existing());
        };
    });
    #[cfg(not(windows))]
    let _ = app;
}

trait AutostartBackend {
    fn is_enabled(&self) -> Result<bool, String>;
    fn enable(&self) -> Result<(), String>;
    fn disable(&self) -> Result<(), String>;
}

fn validate_settings_window(label: &str) -> Result<(), String> {
    if label != super::SETTINGS_WINDOW_LABEL {
        return Err("autostart command called from an unexpected window".to_owned());
    }
    Ok(())
}

fn update_autostart(backend: &impl AutostartBackend, enabled: bool) -> Result<bool, String> {
    let current = backend.is_enabled()?;
    if current == enabled {
        // In particular, do not delete an absent Windows Run entry.
        return Ok(current);
    }
    if enabled {
        backend.enable()?;
    } else {
        backend.disable()?;
    }
    // The operating system registration, not a cached preference, is authoritative.
    backend.is_enabled()
}

#[tauri::command]
pub async fn get_autostart_enabled(app: AppHandle, window: WebviewWindow) -> Result<bool, String> {
    validate_settings_window(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let access = app.state::<AutostartAccess>();
        let _guard = access
            .0
            .lock()
            .map_err(|_| "autostart access is unavailable".to_owned())?;
        let backend = SystemAutostart::new(&app)?;
        backend.migrate_existing()?;
        backend.is_enabled()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_autostart_enabled(
    app: AppHandle,
    window: WebviewWindow,
    enabled: bool,
) -> Result<bool, String> {
    validate_settings_window(window.label())?;
    tauri::async_runtime::spawn_blocking(move || {
        let access = app.state::<AutostartAccess>();
        let _guard = access
            .0
            .lock()
            .map_err(|_| "autostart access is unavailable".to_owned())?;
        update_autostart(&SystemAutostart::new(&app)?, enabled)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::{update_autostart, validate_settings_window, AutostartBackend};

    #[derive(Default)]
    struct FakeAutostart {
        enabled: Cell<bool>,
        fail_read: Cell<bool>,
        fail_write: bool,
        fail_readback: bool,
        ignore_write: bool,
        operations: RefCell<Vec<&'static str>>,
    }

    impl FakeAutostart {
        fn write(&self, enabled: bool) -> Result<(), String> {
            self.operations
                .borrow_mut()
                .push(if enabled { "enable" } else { "disable" });
            if self.fail_write {
                return Err("write failed".to_owned());
            }
            if !self.ignore_write {
                self.enabled.set(enabled);
            }
            self.fail_read.set(self.fail_readback);
            Ok(())
        }
    }

    impl AutostartBackend for FakeAutostart {
        fn is_enabled(&self) -> Result<bool, String> {
            self.operations.borrow_mut().push("read");
            if self.fail_read.get() {
                return Err("read failed".to_owned());
            }
            Ok(self.enabled.get())
        }

        fn enable(&self) -> Result<(), String> {
            self.write(true)
        }

        fn disable(&self) -> Result<(), String> {
            self.write(false)
        }
    }

    #[test]
    fn only_settings_can_access_autostart_commands() {
        assert!(validate_settings_window("settings").is_ok());
        for label in ["main", "about", "chart", "unexpected", ""] {
            assert!(validate_settings_window(label).is_err());
        }
    }

    #[test]
    fn enabling_and_disabling_return_the_system_readback() {
        let backend = FakeAutostart::default();
        assert_eq!(update_autostart(&backend, true), Ok(true));
        assert_eq!(update_autostart(&backend, false), Ok(false));
        assert_eq!(
            *backend.operations.borrow(),
            ["read", "enable", "read", "read", "disable", "read"]
        );
    }

    #[test]
    fn repeated_requests_do_not_rewrite_registration() {
        for enabled in [false, true] {
            let backend = FakeAutostart {
                enabled: Cell::new(enabled),
                ..Default::default()
            };
            assert_eq!(update_autostart(&backend, enabled), Ok(enabled));
            assert_eq!(*backend.operations.borrow(), ["read"]);
        }
    }

    #[test]
    fn failed_initial_read_never_changes_registration() {
        let backend = FakeAutostart {
            fail_read: Cell::new(true),
            ..Default::default()
        };
        assert_eq!(
            update_autostart(&backend, true),
            Err("read failed".to_owned())
        );
        assert_eq!(*backend.operations.borrow(), ["read"]);
    }

    #[test]
    fn failed_write_and_readback_are_reported() {
        let backend = FakeAutostart {
            fail_write: true,
            ..Default::default()
        };
        assert_eq!(
            update_autostart(&backend, true),
            Err("write failed".to_owned())
        );
        assert_eq!(*backend.operations.borrow(), ["read", "enable"]);

        let backend = FakeAutostart {
            fail_readback: true,
            ..Default::default()
        };
        assert_eq!(
            update_autostart(&backend, true),
            Err("read failed".to_owned())
        );
        assert_eq!(*backend.operations.borrow(), ["read", "enable", "read"]);
    }

    #[test]
    fn readback_does_not_claim_a_write_took_effect() {
        let backend = FakeAutostart {
            ignore_write: true,
            ..Default::default()
        };
        assert_eq!(update_autostart(&backend, true), Ok(false));
    }
}
