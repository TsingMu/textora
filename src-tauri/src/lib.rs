use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    Emitter, Manager,
    menu::{
        AboutMetadata, CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu,
    },
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
const APP_WORD_WRAP_MENU_ID: &str = "textora-word-wrap";
const WORD_WRAP_CHANGED_EVENT: &str = "textora-word-wrap-changed";
const APP_SYNTAX_SUBMENU_ID: &str = "textora-syntax";
const APP_SYNTAX_MENU_PREFIX: &str = "textora-syntax-";
const SYNTAX_MODE_CHANGED_EVENT: &str = "textora-syntax-mode-changed";

/// 原生 `View > Syntax` 的固定模式清单（`LanguageMode`、菜单文案），顺序即子菜单顺序。
/// 菜单项 id 为 `textora-syntax-{mode}`；事件只回传表内明确的 `mode` 字符串。
const SYNTAX_MODES: &[(&str, &str)] = &[
    ("plain-text", "Plain Text"),
    ("javascript", "JavaScript"),
    ("typescript", "TypeScript"),
    ("json", "JSON"),
    ("html", "HTML"),
    ("css", "CSS"),
    ("rust", "Rust"),
    ("python", "Python"),
    ("java", "Java"),
    ("shell", "Shell"),
    ("sql", "SQL"),
    ("toml", "TOML"),
    ("yaml", "YAML"),
    ("markdown", "Markdown"),
    ("mermaid", "Mermaid"),
];

/// 原生 `View > Syntax` 选择事件载荷：携带固定清单内的明确 `LanguageMode`，前端只在
/// 活动标签未保存且模式受支持时采用。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyntaxModeChanged {
    mode: String,
}

/// `mode` 是否为固定清单内的受支持模式。
fn syntax_mode_is_supported(mode: &str) -> bool {
    SYNTAX_MODES.iter().any(|(known, _)| *known == mode)
}

/// 重建 `View > Syntax` 模式项被点击前的勾选状态。macOS 点击 check item 时已先切换
/// 自身勾选，事件处理入口读到的是点击后的值：点击前勾选 = 被点击项取反、其余项保持
/// 入口值。`entry_checked` 与 `clicked_index` 分别为入口勾选向量与被点击项下标。
fn syntax_pre_click_checked(entry_checked: &[bool], clicked_index: usize) -> Vec<bool> {
    entry_checked
        .iter()
        .enumerate()
        .map(|(index, checked)| {
            if index == clicked_index {
                !checked
            } else {
                *checked
            }
        })
        .collect()
}

/// 按 View 子菜单中的固定 id 取出 Word Wrap check item。
fn word_wrap_menu_item(app_handle: &tauri::AppHandle) -> Option<CheckMenuItem<tauri::Wry>> {
    let menu = app_handle.menu()?;
    let view_submenu = menu.items().ok()?.into_iter().find_map(|kind| match kind {
        MenuItemKind::Submenu(sub) if sub.text().ok().as_deref() == Some("View") => Some(sub),
        _ => None,
    })?;
    match view_submenu.get(APP_WORD_WRAP_MENU_ID)? {
        MenuItemKind::Check(item) => Some(item),
        _ => None,
    }
}

/// 取出 `View > Syntax` 子菜单内的全部模式 check item，顺序与 {@link SYNTAX_MODES} 一致。
fn syntax_menu_items(app_handle: &tauri::AppHandle) -> Option<Vec<CheckMenuItem<tauri::Wry>>> {
    let menu = app_handle.menu()?;
    let view_submenu = menu.items().ok()?.into_iter().find_map(|kind| match kind {
        MenuItemKind::Submenu(sub) if sub.text().ok().as_deref() == Some("View") => Some(sub),
        _ => None,
    })?;
    let syntax_submenu = match view_submenu.get(APP_SYNTAX_SUBMENU_ID)? {
        MenuItemKind::Submenu(sub) => sub,
        _ => return None,
    };
    let mut items = Vec::with_capacity(SYNTAX_MODES.len());
    for (mode, _) in SYNTAX_MODES {
        let menu_id = format!("{APP_SYNTAX_MENU_PREFIX}{mode}");
        match syntax_submenu.get(menu_id.as_str())? {
            MenuItemKind::Check(item) => items.push(item),
            _ => return None,
        }
    }
    Some(items)
}

/// 原生 View > Word Wrap 切换事件载荷：携带点击后切换的明确勾选值，前端直接采用。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WordWrapChanged {
    enabled: bool,
}

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

/// 前端在注册 `textora-word-wrap-changed` 监听并同步偏好后调用：把菜单勾选设置为当前
/// 偏好并启用菜单。只接受布尔值，不回写前端偏好、不产生菜单事件；失败时菜单保持禁用，
/// 下次应用启动重新尝试。
#[tauri::command]
fn initialize_word_wrap_menu(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let item =
        word_wrap_menu_item(&app).ok_or_else(|| "Word Wrap menu item is unavailable".to_owned())?;
    item.set_checked(enabled)
        .map_err(|error| error.to_string())?;
    item.set_enabled(true).map_err(|error| error.to_string())?;
    Ok(())
}

/// 前端在注册 `textora-syntax-mode-changed` 监听并武装同步后按活动标签状态调用：活动
/// 标签可操作时启用全部模式项并唯一勾选 `checked_mode`，否则禁用并清除全部勾选。
/// `checked_mode` 仅接受固定清单内的模式（可用时必填），不建立任意字符串到能力的通道；
/// 不回写前端状态、不产生菜单事件。失败时菜单保持现状，前端继续按标签状态工作。
#[tauri::command]
fn update_syntax_menu(
    app: tauri::AppHandle,
    available: bool,
    checked_mode: Option<String>,
) -> Result<(), String> {
    let checked_mode = if available {
        Some(
            checked_mode
                .as_deref()
                .filter(|mode| syntax_mode_is_supported(mode))
                .ok_or_else(|| "Unsupported syntax mode".to_owned())?,
        )
    } else {
        None
    };
    let items =
        syntax_menu_items(&app).ok_or_else(|| "Syntax menu items are unavailable".to_owned())?;
    for (index, item) in items.iter().enumerate() {
        let is_checked = checked_mode == Some(SYNTAX_MODES[index].0);
        item.set_checked(is_checked)
            .map_err(|error| error.to_string())?;
        item.set_enabled(available)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
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
    // 门禁：默认勾选但禁用，前端完成事件监听注册与偏好同步后经受限命令启用。
    let word_wrap_item = CheckMenuItem::with_id(
        app_handle,
        APP_WORD_WRAP_MENU_ID,
        "Word Wrap",
        false,
        true,
        None::<&str>,
    )?;
    // View > Syntax：固定模式清单的受限单选子菜单；初始全部禁用且不勾选，前端注册
    // 监听并武装同步后经 update_syntax_menu 启用并同步唯一勾选项。
    let syntax_check_items = SYNTAX_MODES
        .iter()
        .map(|(mode, label)| {
            CheckMenuItem::with_id(
                app_handle,
                format!("{APP_SYNTAX_MENU_PREFIX}{mode}"),
                *label,
                false,
                false,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let syntax_item_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = syntax_check_items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let syntax_submenu = Submenu::with_id_and_items(
        app_handle,
        APP_SYNTAX_SUBMENU_ID,
        "Syntax",
        true,
        &syntax_item_refs,
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
                &[
                    &word_wrap_item,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &syntax_submenu,
                    &PredefinedMenuItem::separator(app_handle)?,
                    &PredefinedMenuItem::fullscreen(app_handle, None)?,
                ],
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
            let id = event.id().as_ref();
            if id == APP_QUIT_MENU_ID {
                emit_app_exit_requested(app_handle);
            } else if id == APP_WORD_WRAP_MENU_ID {
                // macOS check item 点击时已先切换自身勾选；读取切换后的值单向通知前端。
                let Some(item) = word_wrap_menu_item(app_handle) else {
                    return;
                };
                let Ok(enabled) = item.is_checked() else {
                    return;
                };
                if app_handle
                    .emit(WORD_WRAP_CHANGED_EVENT, WordWrapChanged { enabled })
                    .is_err()
                {
                    // 事件发送失败：恢复点击前勾选，前端状态保持不变。
                    let _ = item.set_checked(!enabled);
                }
            } else if let Some(mode) = id
                .strip_prefix(APP_SYNTAX_MENU_PREFIX)
                .filter(|mode| syntax_mode_is_supported(mode))
            {
                // 固定清单内的模式项被点击：先就地修复为单选勾选，再向前端发明确载荷；
                // 事件发送失败时恢复点击前勾选（macOS 点击已先切换自身勾选，入口值需
                // 取反重建点击前状态），避免菜单展示不可信状态。前端采用与否由标签状态
                // 决定，菜单勾选随后经 update_syntax_menu 对齐。
                let Some(index) = SYNTAX_MODES.iter().position(|(known, _)| *known == mode) else {
                    return;
                };
                let Some(items) = syntax_menu_items(app_handle) else {
                    return;
                };
                let entry_checked: Vec<bool> = items
                    .iter()
                    .map(|item| item.is_checked().unwrap_or(false))
                    .collect();
                let previous = syntax_pre_click_checked(&entry_checked, index);
                for (item_index, item) in items.iter().enumerate() {
                    let _ = item.set_checked(item_index == index);
                }
                if app_handle
                    .emit(
                        SYNTAX_MODE_CHANGED_EVENT,
                        SyntaxModeChanged {
                            mode: mode.to_owned(),
                        },
                    )
                    .is_err()
                {
                    for (item_index, item) in items.iter().enumerate() {
                        let _ = item.set_checked(previous[item_index]);
                    }
                }
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
            request_app_exit,
            initialize_word_wrap_menu,
            update_syntax_menu
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

    #[test]
    fn syntax_modes_are_unique_complete_menu_ids() {
        // 固定模式清单唯一、文案非空，且菜单 id 与 `LanguageMode` 一一对应。
        let mut seen = std::collections::HashSet::new();
        for (mode, label) in SYNTAX_MODES {
            assert!(
                seen.insert(*mode),
                "duplicate syntax mode {mode:?} in SYNTAX_MODES"
            );
            assert!(!label.trim().is_empty(), "empty label for mode {mode:?}");
            let menu_id = format!("{APP_SYNTAX_MENU_PREFIX}{mode}");
            assert_eq!(
                menu_id.strip_prefix(APP_SYNTAX_MENU_PREFIX),
                Some(*mode),
                "menu id must round-trip to its mode"
            );
        }
        assert_eq!(SYNTAX_MODES.len(), 15);
        assert!(seen.contains("plain-text"));
        assert!(seen.contains("mermaid"));
    }

    #[test]
    fn syntax_mode_support_rejects_unlisted_modes() {
        // 只有固定清单内的模式可经菜单 id 解析并被命令接受；前缀本身、空串或未知模式
        // 一律拒绝，避免任意字符串进入事件载荷。
        for mode in ["plain-text", "java", "markdown", "mermaid"] {
            assert!(syntax_mode_is_supported(mode));
        }
        for value in [
            "",
            "cobol",
            "java2",
            APP_SYNTAX_MENU_PREFIX,
            "textora-syntax-java",
        ] {
            assert!(
                !syntax_mode_is_supported(value),
                "unexpected accept {value:?}"
            );
        }
    }

    #[test]
    fn syntax_rollback_restores_pre_click_checked_for_already_checked_item() {
        // 事件发送失败时点击已勾选项：macOS 已先把该项切换为未勾选，回滚必须恢复为
        // 点击前的勾选，而不是入口读到的全未勾选。
        let entry_checked = [false, false, false];
        assert_eq!(
            syntax_pre_click_checked(&entry_checked, 1),
            vec![false, true, false]
        );
    }

    #[test]
    fn syntax_rollback_restores_pre_click_checked_for_unchecked_item() {
        // 事件发送失败时点击未勾选项：macOS 已先勾选被点击项，回滚必须只保留点击前
        // 原勾选项，清除被点击项，而不是恢复成双勾选。
        let entry_checked = [true, true, false];
        assert_eq!(
            syntax_pre_click_checked(&entry_checked, 1),
            vec![true, false, false]
        );
    }
}
