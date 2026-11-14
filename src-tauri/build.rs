fn main() {
    println!("cargo:rerun-if-changed=windows/app.manifest");
    let mut attributes = tauri_build::Attributes::new();
    // Packaged Windows applications request elevation through the OS. Debug
    // builds keep normal privileges so unit tests never trigger a UAC prompt.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("PROFILE").as_deref() == Ok("release")
    {
        attributes = attributes.windows_attributes(
            tauri_build::WindowsAttributes::new()
                .app_manifest(include_str!("windows/app.manifest")),
        );
    }
    tauri_build::try_build(
        attributes.app_manifest(tauri_build::AppManifest::new().commands(&[
            "minimize_window",
            "close_window",
            "ensure_always_on_top",
            "set_monitor_layout",
            "resize_monitor_height",
            "show_chart_window",
            "get_chart_selection",
            "close_chart_window",
            "get_autostart_enabled",
            "set_autostart_enabled",
            "get_system_metrics",
            "get_temperature_status",
        ])),
    )
    .expect("failed to configure the Tauri build");
}
