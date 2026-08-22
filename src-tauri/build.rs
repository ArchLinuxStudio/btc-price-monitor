fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "minimize_window",
            "close_window",
            "ensure_always_on_top",
            "set_monitor_layout",
        ]),
    ))
    .expect("failed to configure the Tauri build");
}
