use serde::Serialize;
use tauri::Emitter;

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

/// 前端在完成未保存关闭确认后请求正常退出。`AppHandle::exit` 触发
/// `RunEvent::ExitRequested { code: Some }`，该路径不被用户退出保护再次拦截。
#[tauri::command]
fn request_app_exit(app: tauri::AppHandle) {
    app.exit(0);
}

/// 用户发起的正常退出（`code: None`）一律先拦截并交给前端判断，避免依赖前端异步同步
/// 的保护状态在时序窗口内被绕过；只有 `request_app_exit` 触发的程序化退出
/// （`code: Some`）才直接放行。
fn should_guard_user_exit(code: Option<i32>) -> bool {
    code.is_none()
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
            ipc::prepare_save_as,
            ipc::pick_save_directory,
            ipc::preview_save_target,
            ipc::save_document_as_at,
            ipc::cancel_conflict,
            ipc::reload_from_conflict,
            ipc::force_overwrite,
            ipc::check_target_exists,
            ipc::close_document,
            request_app_exit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if should_guard_user_exit(code) {
                    api.prevent_exit();
                    let _ = app_handle.emit("textora-app-exit-requested", ());
                }
            }
        });
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

    #[test]
    fn guards_every_user_initiated_exit() {
        // 用户发起的正常退出（code 为 None）一律拦截并交还前端，不依赖前端异步武装的状态。
        assert!(should_guard_user_exit(None));
    }

    #[test]
    fn never_guards_programmatic_exit() {
        // request_app_exit 触发的程序化退出（code 为 Some）始终放行，避免循环拦截。
        assert!(!should_guard_user_exit(Some(0)));
    }
}
