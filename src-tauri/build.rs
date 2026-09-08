fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "minimize_window",
            "close_window",
            "ensure_always_on_top",
            "set_monitor_layout",
            "resize_monitor_height",
            "show_chart_window",
            "get_chart_selection",
            "close_chart_window",
        ]),
    ))
    .expect("failed to configure the Tauri build");
}
