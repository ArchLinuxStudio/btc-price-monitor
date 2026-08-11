use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, RunEvent, WebviewWindow, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";

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
    main_window(app)?
        .hide()
        .map_err(|error| error.to_string())
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show-window", "显示窗口", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide-window", "隐藏窗口", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 Crypto Top", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("crypto-top-tray")
        .menu(&menu)
        .tooltip("Crypto Top · BTC / ETH")
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
            ensure_always_on_top
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
