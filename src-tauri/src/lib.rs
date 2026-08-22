use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const MONITOR_WIDTH: u32 = 208;
const MONITOR_MIN_HEIGHT: u32 = 92;
const MONITOR_MAX_HEIGHT: u32 = 170;

fn monitor_height(row_count: u32, management_open: bool, item_count: u32) -> u32 {
    if management_open {
        let visible_items = item_count.clamp(1, 4);
        (58 + 28 * visible_items).clamp(MONITOR_MIN_HEIGHT, MONITOR_MAX_HEIGHT)
    } else {
        let visible_rows = row_count.clamp(2, 4);
        26 + 33 * visible_rows
    }
}

fn apply_window_behavior(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    window
        .set_skip_taskbar(true)
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

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is unavailable".to_owned())
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    let window = main_window(app)?;
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    apply_window_behavior(&window)?;
    window.set_focus().map_err(|error| error.to_string())
}

fn hide_main_window(app: &AppHandle) -> Result<(), String> {
    main_window(app)?.hide().map_err(|error| error.to_string())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show-window", "显示窗口", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide-window", "隐藏窗口", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 Crypto Top", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("crypto-top-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-window" => {
                let _ = show_main_window(app);
            }
            "hide-window" => {
                let _ = hide_main_window(app);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn ensure_always_on_top(window: WebviewWindow) -> Result<(), String> {
    apply_window_behavior(&window)
}

#[tauri::command]
fn set_monitor_layout(
    window: WebviewWindow,
    row_count: u32,
    management_open: bool,
    item_count: u32,
) -> Result<(), String> {
    let height = monitor_height(row_count, management_open, item_count);
    window
        .set_size(LogicalSize::new(
            f64::from(MONITOR_WIDTH),
            f64::from(height),
        ))
        .map_err(|error| error.to_string())?;
    apply_window_behavior(&window)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            setup_tray(app)?;

            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                apply_window_behavior(&window).map_err(std::io::Error::other)?;
                place_near_top_right(&window);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(true) => {
                if let Some(webview_window) = window.app_handle().get_webview_window(window.label())
                {
                    let _ = apply_window_behavior(&webview_window);
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            close_window,
            ensure_always_on_top,
            set_monitor_layout
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Crypto Top application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Resumed) {
            if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = apply_window_behavior(&window);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{monitor_height, MONITOR_MAX_HEIGHT, MONITOR_MIN_HEIGHT};

    #[test]
    fn quote_layout_height_is_clamped_to_two_through_four_rows() {
        assert_eq!(monitor_height(0, false, 0), MONITOR_MIN_HEIGHT);
        assert_eq!(monitor_height(1, false, 0), MONITOR_MIN_HEIGHT);
        assert_eq!(monitor_height(2, false, 0), 92);
        assert_eq!(monitor_height(3, false, 0), 125);
        assert_eq!(monitor_height(4, false, 0), 158);
        assert_eq!(monitor_height(5, false, 0), 158);
        assert_eq!(monitor_height(u32::MAX, false, 0), 158);
    }

    #[test]
    fn management_layout_height_is_clamped_to_one_through_four_items() {
        assert_eq!(monitor_height(0, true, 0), MONITOR_MIN_HEIGHT);
        assert_eq!(monitor_height(0, true, 1), MONITOR_MIN_HEIGHT);
        assert_eq!(monitor_height(0, true, 2), 114);
        assert_eq!(monitor_height(0, true, 3), 142);
        assert_eq!(monitor_height(0, true, 4), MONITOR_MAX_HEIGHT);
        assert_eq!(monitor_height(0, true, 5), MONITOR_MAX_HEIGHT);
        assert_eq!(monitor_height(0, true, u32::MAX), MONITOR_MAX_HEIGHT);
    }
}
