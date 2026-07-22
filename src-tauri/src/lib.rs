use serde::Serialize;

pub mod document;
pub mod ipc;

use ipc::DocumentStore;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthStatus {
    service: &'static str,
    version: &'static str,
}

#[tauri::command]
fn health_check() -> HealthStatus {
    HealthStatus {
        service: "document-core",
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DocumentStore::default())
        .invoke_handler(tauri::generate_handler![
            health_check,
            ipc::select_and_open_document,
            ipc::read_document_content,
            ipc::save_document,
            ipc::save_document_as
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_check_identifies_the_document_core() {
        assert_eq!(
            health_check(),
            HealthStatus {
                service: "document-core",
                version: env!("CARGO_PKG_VERSION"),
            }
        );
    }
}
