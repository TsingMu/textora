use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    Emitter, Manager,
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
};

pub mod document;
pub mod external_watch;
pub mod ipc;
pub mod session_restore;

use ipc::DocumentStore;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthStatus {
    service: &'static str,
    version: &'static str,
}

#[derive(Default)]
struct ExitGuard {
    programmatic_exit_requested: AtomicBool,
}

const APP_QUIT_MENU_ID: &str = "textora-app-quit";
const APP_EXIT_REQUESTED_EVENT: &str = "textora-app-exit-requested";
const MAIN_WINDOW_LABEL: &str = "main";

#[tauri::command]
fn health_check() -> HealthStatus {
    HealthStatus {
        service: "document-core",
        version: env!("CARGO_PKG_VERSION"),
    }
}

/// 前端在完成未保存关闭确认后请求正常退出。`AppHandle::exit` 触发
/// `RunEvent::ExitRequested`；该路径通过 Rust 侧一次性标记放行，不被用户退出保护再次拦截。
#[tauri::command]
fn request_app_exit(app: tauri::AppHandle, guard: tauri::State<'_, ExitGuard>) {
    guard
        .programmatic_exit_requested
        .store(true, Ordering::SeqCst);
    app.exit(0);
}

/// 用户发起的退出一律先拦截并交给前端判断，避免依赖前端异步同步的保护状态在时序窗口内
/// 被绕过；只有 `request_app_exit` 设置的一次性 Rust 标记才直接放行。
fn should_guard_user_exit(guard: &ExitGuard) -> bool {
    !guard
        .programmatic_exit_requested
        .swap(false, Ordering::SeqCst)
}

fn emit_app_exit_requested(app_handle: &tauri::AppHandle) {
    let _ = app_handle.emit(APP_EXIT_REQUESTED_EVENT, ());
}

#[cfg(target_os = "macos")]
fn show_main_window(app_handle: &tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    if let Some(window_config) = app_handle
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW_LABEL)
    {
        if let Ok(window) = tauri::WebviewWindowBuilder::from_config(app_handle, window_config)
            .and_then(|builder| builder.build())
        {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg(target_os = "macos")]
fn build_app_menu(app_handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let pkg_info = app_handle.package_info();
    let config = app_handle.config();
    let about_metadata = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let quit_text = format!("Quit {}", pkg_info.name);
    let quit_item = MenuItem::with_id(
        app_handle,
        APP_QUIT_MENU_ID,
        quit_text,
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let window_menu = Submenu::with_id_and_items(
        app_handle,
        "Window",
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app_handle, None)?,
            &PredefinedMenuItem::maximize(app_handle, None)?,
            &PredefinedMenuItem::separator(app_handle)?,
            &PredefinedMenuItem::close_window(app_handle, None)?,
        ],
    )?;
    let help_menu = Submenu::with_id_and_items(app_handle, "Help", "Help", true, &[])?;

    Menu::with_items(
        app_handle,
        &[
            &Submenu::with_items(
                app_handle,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app_handle, None, Some(about_metadata))?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::services(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::hide(app_handle, None)?,
                    &PredefinedMenuItem::hide_others(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &quit_item,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(app_handle, None)?],
            )?,
            &Submenu::with_items(
                app_handle,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app_handle, None)?,
                    &PredefinedMenuItem::redo(app_handle, None)?,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::cut(app_handle, None)?,
                    &PredefinedMenuItem::copy(app_handle, None)?,
                    &PredefinedMenuItem::paste(app_handle, None)?,
                    &PredefinedMenuItem::select_all(app_handle, None)?,
                ],
            )?,
            &Submenu::with_items(
                app_handle,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app_handle, None)?],
            )?,
            &window_menu,
            &help_menu,
        ],
    )
}

#[cfg(not(target_os = "macos"))]
fn build_app_menu(app_handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    Menu::default(app_handle)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DocumentStore::default())
        .manage(ExitGuard::default())
        .setup(|app| {
            let watcher = external_watch::ExternalWatchService::new(app.handle().clone())?;
            app.manage(watcher);
            app.manage(ipc::SessionRestoreCursor::default());
            if let Ok(manifests) = session_restore::SessionManifestStore::from_app(app.handle()) {
                app.manage(manifests);
            }
            Ok(())
        })
        .menu(build_app_menu)
        .on_menu_event(|app_handle, event| {
            if event.id().as_ref() == APP_QUIT_MENU_ID {
                emit_app_exit_requested(app_handle);
            }
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            ipc::select_and_open_document,
            ipc::read_document_content,
            ipc::restore_next_session_document,
            ipc::update_open_files_manifest,
            ipc::prepare_external_reload,
            ipc::retry_external_reload,
            ipc::refresh_external_document,
            ipc::prepare_external_conflict,
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
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                let guard = app_handle.state::<ExitGuard>();
                if should_guard_user_exit(&guard) {
                    api.prevent_exit();
                    emit_app_exit_requested(app_handle);
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } => {
                if !has_visible_windows {
                    show_main_window(app_handle);
                }
            }
            _ => {}
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
        // 用户发起的退出没有 Rust 侧程序化标记，一律拦截并交还前端，不依赖前端异步武装的状态。
        let guard = ExitGuard::default();
        assert!(should_guard_user_exit(&guard));
    }

    #[test]
    fn allows_exactly_one_programmatic_exit() {
        // request_app_exit 触发的程序化退出经 Rust 侧一次性标记放行，避免循环拦截。
        let guard = ExitGuard::default();
        guard
            .programmatic_exit_requested
            .store(true, Ordering::SeqCst);
        assert!(!should_guard_user_exit(&guard));
        assert!(should_guard_user_exit(&guard));
    }
}
