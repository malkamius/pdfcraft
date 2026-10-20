fn strip_bom_from_capabilities() {
    if let Ok(entries) = std::fs::read_dir("capabilities") {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(bytes) = std::fs::read(&path) {
                    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
                        let _ = std::fs::write(&path, &bytes[3..]);
                    }
                }
            }
        }
    }
}

fn clean_stale_resource_cache() {
    if let Ok(out_dir) = std::env::var("OUT_DIR") {
        let out_path = std::path::Path::new(&out_dir);
        // Remove stale resource.lib/resource.rc in OUT_DIR so tauri-build/embed-resource always rebuilds them
        let _ = std::fs::remove_file(out_path.join("resource.lib"));
        let _ = std::fs::remove_file(out_path.join("resource.rc"));
        let _ = std::fs::remove_file(out_path.join("resource.res"));

        // Remove cached bundle icon (target/<profile>/resources/icon.ico) so WiX re-copies the new icon
        if let Some(target_profile_dir) = out_path.ancestors().nth(3) {
            let cached_ico = target_profile_dir.join("resources").join("icon.ico");
            if cached_ico.exists() {
                let _ = std::fs::remove_file(cached_ico);
            }
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    strip_bom_from_capabilities();
    clean_stale_resource_cache();
    // The production build serves the frontend from a loopback HTTP server instead of the
    // `tauri://localhost` custom protocol (WKWebView does not treat custom schemes as a
    // secure context, which breaks Cross-Origin Isolation / SharedArrayBuffer). That origin
    // is classified as *remote*, so the command permissions have to be declared here and
    // granted in the capability for them to stay callable from the frontend.
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_files",
            "save_file",
            "read_file",
            "write_file",
            "get_temp_dir",
            "open_url",
            "get_system_printers",
            "print_pdf_file",
            "close_app",
            "get_cli_open_files",
        ]),
    );
    if let Err(error) = tauri_build::try_build(attributes) {
        eprintln!("Error in tauri_build: {error:#}");
        std::process::exit(1);
    }
}
