use serde::Serialize;

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
        .invoke_handler(tauri::generate_handler![health_check])
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
