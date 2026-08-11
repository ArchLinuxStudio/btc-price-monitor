use tauri::{Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent};

fn apply_topmost(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn place_near_top_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let Ok(window_size) = window.outer_size() else {
        return;
    };

    let work_area = monitor.work_area();
    let padding = (16.0 * monitor.scale_factor()).round() as i32;
    let available_width = work_area.size.width.saturating_sub(window_size.width) as i32;
    let x = work_area.position.x + (available_width - padding).max(0);
    let y = work_area.position.y + padding;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_window(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn ensure_always_on_top(window: WebviewWindow) -> Result<(), String> {
    apply_topmost(&window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                apply_topmost(&window).map_err(std::io::Error::other)?;
                place_near_top_right(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Focused(true)) {
                if let Some(webview_window) = window.app_handle().get_webview_window(window.label())
                {
                    let _ = apply_topmost(&webview_window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            close_window,
            ensure_always_on_top
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Crypto Top application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Resumed) {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = apply_topmost(&window);
            }
        }
    });
}
