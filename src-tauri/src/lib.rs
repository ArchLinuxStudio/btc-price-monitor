use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, RunEvent, State, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const ABOUT_WINDOW_LABEL: &str = "about";
const MONITOR_WIDTH: u32 = 208;
const MONITOR_MIN_HEIGHT: u32 = 92;
const MONITOR_MANAGEMENT_MAX_HEIGHT: u32 = 170;

#[derive(Debug, Default)]
struct MonitorLayoutState {
    management_open: bool,
    quote_height: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayAction {
    ShowMain,
    HideMain,
    ShowAbout,
    Quit,
}

fn quote_auto_height(row_count: u32) -> u32 {
    let visible_rows = row_count.clamp(2, 4);
    26 + 33 * visible_rows
}

fn quote_content_height(row_count: u32) -> u32 {
    26u32.saturating_add(33u32.saturating_mul(row_count.max(2)))
}

fn quote_height(row_count: u32, requested_height: u32, available_height: u32) -> u32 {
    let minimum_height = quote_auto_height(row_count);
    let maximum_height = quote_content_height(row_count)
        .min(available_height)
        .max(minimum_height);
    requested_height.clamp(minimum_height, maximum_height)
}

fn monitor_height(row_count: u32, management_open: bool, item_count: u32) -> u32 {
    if management_open {
        let visible_items = item_count.clamp(1, 4);
        (58 + 28 * visible_items).clamp(MONITOR_MIN_HEIGHT, MONITOR_MANAGEMENT_MAX_HEIGHT)
    } else {
        quote_auto_height(row_count)
    }
}

fn set_monitor_size(window: &WebviewWindow, height: u32) -> Result<(), String> {
    window
        .set_size(LogicalSize::new(
            f64::from(MONITOR_WIDTH),
            f64::from(height),
        ))
        .map_err(|error| error.to_string())
}

fn logical_available_height(
    work_area_top: i32,
    work_area_height: u32,
    window_top: i32,
    scale_factor: f64,
) -> u32 {
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return u32::MAX;
    }

    let window_top = window_top.max(work_area_top);
    let work_area_bottom = i64::from(work_area_top) + i64::from(work_area_height);
    let available_physical_height = work_area_bottom
        .saturating_sub(i64::from(window_top))
        .max(0) as u64;
    ((available_physical_height as f64 / scale_factor).floor() as u32).max(MONITOR_MIN_HEIGHT)
}

fn available_quote_height(window: &WebviewWindow) -> u32 {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return u32::MAX;
    };

    let work_area = monitor.work_area();
    let window_top = window
        .outer_position()
        .map(|position| position.y)
        .unwrap_or(work_area.position.y);
    logical_available_height(
        work_area.position.y,
        work_area.size.height,
        window_top,
        monitor.scale_factor(),
    )
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

fn about_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(ABOUT_WINDOW_LABEL)
        .ok_or_else(|| "about window is unavailable".to_owned())
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

fn show_about_window(app: &AppHandle) -> Result<(), String> {
    let window = about_window(app)?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn hides_on_close(label: &str) -> bool {
    label == MAIN_WINDOW_LABEL || label == ABOUT_WINDOW_LABEL
}

fn tray_action(id: &str) -> Option<TrayAction> {
    match id {
        "show-window" => Some(TrayAction::ShowMain),
        "hide-window" => Some(TrayAction::HideMain),
        "about" => Some(TrayAction::ShowAbout),
        "quit" => Some(TrayAction::Quit),
        _ => None,
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show-window", "显示窗口", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide-window", "隐藏窗口", true, None::<&str>)?;
    let window_separator = PredefinedMenuItem::separator(app)?;
    let about_item = MenuItem::with_id(app, "about", "关于 Crypto Top", true, None::<&str>)?;
    let quit_separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 Crypto Top", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &hide_item,
            &window_separator,
            &about_item,
            &quit_separator,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("crypto-top-tray")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_action(event.id().as_ref()) {
            Some(TrayAction::ShowMain) => {
                let _ = show_main_window(app);
            }
            Some(TrayAction::HideMain) => {
                let _ = hide_main_window(app);
            }
            Some(TrayAction::ShowAbout) => {
                let _ = show_about_window(app);
            }
            Some(TrayAction::Quit) => app.exit(0),
            None => {}
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
    layout_state: State<'_, Mutex<MonitorLayoutState>>,
    row_count: u32,
    management_open: bool,
    item_count: u32,
) -> Result<(), String> {
    let available_height = available_quote_height(&window);
    let mut state = layout_state
        .lock()
        .map_err(|_| "monitor layout state is unavailable".to_owned())?;
    let previous_management_open = state.management_open;
    let previous_quote_height = state.quote_height;
    let height = if management_open {
        monitor_height(row_count, true, item_count)
    } else {
        let requested_height = state
            .quote_height
            .unwrap_or_else(|| quote_auto_height(row_count));
        let height = quote_height(row_count, requested_height, available_height);
        state.quote_height = Some(height);
        height
    };
    state.management_open = management_open;
    if let Err(error) = set_monitor_size(&window, height) {
        state.management_open = previous_management_open;
        state.quote_height = previous_quote_height;
        return Err(error);
    }
    drop(state);
    apply_window_behavior(&window)
}

#[tauri::command]
fn resize_monitor_height(
    window: WebviewWindow,
    layout_state: State<'_, Mutex<MonitorLayoutState>>,
    row_count: u32,
    requested_height: u32,
) -> Result<u32, String> {
    let available_height = available_quote_height(&window);
    let mut state = layout_state
        .lock()
        .map_err(|_| "monitor layout state is unavailable".to_owned())?;
    if state.management_open {
        return Err("monitor height cannot be dragged while management is open".to_owned());
    }

    let previous_quote_height = state.quote_height;
    let height = quote_height(row_count, requested_height, available_height);
    state.quote_height = Some(height);
    if let Err(error) = set_monitor_size(&window, height) {
        state.quote_height = previous_quote_height;
        return Err(error);
    }
    Ok(height)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(MonitorLayoutState::default()))
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
            WindowEvent::Focused(true) if window.label() == MAIN_WINDOW_LABEL => {
                if let Some(webview_window) = window.app_handle().get_webview_window(window.label())
                {
                    let _ = apply_window_behavior(&webview_window);
                }
            }
            WindowEvent::CloseRequested { api, .. } if hides_on_close(window.label()) => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            close_window,
            ensure_always_on_top,
            set_monitor_layout,
            resize_monitor_height
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
    use super::{
        hides_on_close, logical_available_height, monitor_height, quote_content_height,
        quote_height, tray_action, TrayAction, MONITOR_MANAGEMENT_MAX_HEIGHT, MONITOR_MIN_HEIGHT,
    };

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
    fn dragged_quote_height_is_clamped_to_auto_and_content_bounds() {
        assert_eq!(quote_height(4, MONITOR_MIN_HEIGHT, 900), 158);
        assert_eq!(quote_height(5, MONITOR_MIN_HEIGHT, 900), 158);
        assert_eq!(quote_height(5, 170, 900), 170);
        assert_eq!(quote_height(5, u32::MAX, 900), 191);
        assert_eq!(quote_height(8, u32::MAX, 900), 290);
        assert_eq!(quote_height(9, u32::MAX, 900), 323);
        assert_eq!(quote_height(40, u32::MAX, 900), 900);
        assert_eq!(quote_height(u32::MAX, u32::MAX, 900), 900);
        assert_eq!(quote_content_height(u32::MAX), u32::MAX);
    }

    #[test]
    fn available_height_respects_window_position_work_area_and_scale() {
        assert_eq!(logical_available_height(0, 1080, 16, 1.0), 1064);
        assert_eq!(logical_available_height(-1440, 1440, -1424, 1.0), 1424);
        assert_eq!(logical_available_height(0, 1350, 20, 1.25), 1064);
        assert_eq!(logical_available_height(0, 1080, -100, 1.0), 1080);
        assert_eq!(logical_available_height(0, 1080, 1200, 1.0), 92);
        assert_eq!(logical_available_height(0, 1080, 16, 0.0), u32::MAX);
    }

    #[test]
    fn management_layout_height_is_clamped_to_one_through_four_items() {
        assert_eq!(monitor_height(0, true, 0), MONITOR_MIN_HEIGHT);
        assert_eq!(monitor_height(0, true, 1), MONITOR_MIN_HEIGHT);
        assert_eq!(monitor_height(0, true, 2), 114);
        assert_eq!(monitor_height(0, true, 3), 142);
        assert_eq!(monitor_height(0, true, 4), MONITOR_MANAGEMENT_MAX_HEIGHT);
        assert_eq!(monitor_height(0, true, 5), MONITOR_MANAGEMENT_MAX_HEIGHT);
        assert_eq!(
            monitor_height(0, true, u32::MAX),
            MONITOR_MANAGEMENT_MAX_HEIGHT
        );
    }

    #[test]
    fn only_managed_windows_hide_instead_of_closing() {
        assert!(hides_on_close("main"));
        assert!(hides_on_close("about"));
        assert!(!hides_on_close("unexpected"));
    }

    #[test]
    fn tray_menu_ids_route_to_the_expected_actions() {
        assert_eq!(tray_action("show-window"), Some(TrayAction::ShowMain));
        assert_eq!(tray_action("hide-window"), Some(TrayAction::HideMain));
        assert_eq!(tray_action("about"), Some(TrayAction::ShowAbout));
        assert_eq!(tray_action("quit"), Some(TrayAction::Quit));
        assert_eq!(tray_action("unexpected"), None);
    }
}
