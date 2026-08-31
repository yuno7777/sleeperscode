use sleepers_code_tauri_experiment::{DEVELOPMENT_URL_ENV, development_url};
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    let configured_url = std::env::var(DEVELOPMENT_URL_ENV).ok();
    let url = development_url(configured_url.as_deref()).unwrap_or_else(|error| {
        eprintln!(
            "Sleepers Code Tauri experiment could not start: {DEVELOPMENT_URL_ENV} must be an explicit loopback HTTP(S) URL ({error:?})."
        );
        std::process::exit(2);
    });

    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Sleepers Code (Tauri Experiment)")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the Sleepers Code Tauri experiment");
}
