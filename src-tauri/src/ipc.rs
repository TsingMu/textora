//! 文档核心的受限 Tauri 命令层。
//!
//! 这些命令把内部 [`document`] 能力以最小方式暴露给前端：元数据走小型 JSON 响应，
//! Unicode 内容走原始二进制——打开经 `ipc::Response` 返回、保存经 `ipc::Request` 的
//! Raw body 与自定义 header 接收，避免把大文本编码为 JSON 数字数组或大字符串。错误
//! 以稳定代码返回，前端据此映射用户可理解的提示，不展示 Rust 内部调试文本。

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

use crate::document::{
    self, DocumentDescriptor, DocumentError, FileFingerprint, LineEnding, TextEncoding,
};

/// 文档 id 自定义 header。保存命令的内容走 Raw body，id 通过该 header 随行。
const DOCUMENT_ID_HEADER: &str = "textora-document-id";

/// 稳定、面向前端的错误代码。新增代码即视为公共契约变更。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocumentErrorCode {
    // 打开与保存共有
    FileTooLarge,
    UnsupportedEncoding,
    ReadFailed,
    // 打开专有
    ChangedDuringRead,
    // 保存专有
    ReadOnly,
    MixedLineEnding,
    UnencodableContent,
    EncodingAmbiguous,
    SaveConflict,
    SaveFailed,
    /// 前端提交的文档 id 后端未知或已过期（如新建文档、被新打开覆盖）。
    UnknownDocument,
}

/// 跨 IPC 的文档命令错误。`character` 与 `byteOffset` 仅在不可编码字符时填充，供
/// 上层展示；其余字段为 `None`。`message` 仅供诊断，不向用户呈现。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCommandError {
    pub code: DocumentErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub character: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_offset: Option<usize>,
}

impl DocumentCommandError {
    fn new(code: DocumentErrorCode, message: &str) -> Self {
        Self {
            code,
            message: message.to_owned(),
            character: None,
            byte_offset: None,
        }
    }

    fn from_open_core(err: DocumentError) -> Self {
        match err {
            DocumentError::SizeLimitExceeded { .. } => Self::new(
                DocumentErrorCode::FileTooLarge,
                "file is larger than the limit",
            ),
            DocumentError::InvalidEncoding => Self::new(
                DocumentErrorCode::UnsupportedEncoding,
                "file is not valid UTF-8 or strict GBK/CP936",
            ),
            DocumentError::ChangedDuringRead => Self::new(
                DocumentErrorCode::ChangedDuringRead,
                "file changed while being read",
            ),
            DocumentError::Io(_) => Self::new(DocumentErrorCode::ReadFailed, "file I/O failed"),
            // 保存侧错误在打开流程不可达；统一收敛为安全的读取失败。
            DocumentError::ReadOnly
            | DocumentError::MixedLineEndingNotChosen
            | DocumentError::UnencodableContent { .. }
            | DocumentError::EncodingAmbiguous
            | DocumentError::SaveConflict => Self::new(
                DocumentErrorCode::ReadFailed,
                "unexpected save-side error during open",
            ),
        }
    }

    fn from_save_core(err: DocumentError) -> Self {
        match err {
            DocumentError::SizeLimitExceeded { .. } => Self::new(
                DocumentErrorCode::FileTooLarge,
                "content is larger than the save limit",
            ),
            DocumentError::ReadOnly => {
                Self::new(DocumentErrorCode::ReadOnly, "document is read-only")
            }
            DocumentError::MixedLineEndingNotChosen => Self::new(
                DocumentErrorCode::MixedLineEnding,
                "line endings are mixed; choose LF or CRLF before saving",
            ),
            DocumentError::UnencodableContent {
                character,
                byte_offset,
            } => Self {
                code: DocumentErrorCode::UnencodableContent,
                message: "content cannot be represented in the target encoding".to_owned(),
                character: Some(character.to_string()),
                byte_offset: Some(byte_offset),
            },
            DocumentError::EncodingAmbiguous => Self::new(
                DocumentErrorCode::EncodingAmbiguous,
                "encoding is ambiguous on reopen; save as UTF-8",
            ),
            DocumentError::SaveConflict => Self::new(
                DocumentErrorCode::SaveConflict,
                "file changed on disk since it was opened",
            ),
            DocumentError::Io(_) => {
                Self::new(DocumentErrorCode::SaveFailed, "file could not be saved")
            }
            // 打开侧错误在保存核心不可达；统一收敛为安全的保存失败。
            DocumentError::InvalidEncoding | DocumentError::ChangedDuringRead => Self::new(
                DocumentErrorCode::SaveFailed,
                "unexpected open-side error during save",
            ),
        }
    }
}

/// 后端持有的可信文档元数据。打开成功后建立，保存成功后更新指纹与字节数。
#[derive(Clone)]
struct TrustedDocument {
    path: PathBuf,
    display_name: String,
    encoding: TextEncoding,
    line_ending: LineEnding,
    fingerprint: FileFingerprint,
    byte_count: u64,
    read_only: bool,
}

impl TrustedDocument {
    fn to_descriptor(
        &self,
        id: &str,
        fingerprint: FileFingerprint,
        byte_count: u64,
    ) -> DocumentDescriptor {
        DocumentDescriptor {
            id: id.to_owned(),
            path: self.path.clone(),
            display_name: self.display_name.clone(),
            byte_count,
            encoding: self.encoding,
            line_ending: self.line_ending,
            fingerprint,
            read_only: self.read_only,
        }
    }
}

#[derive(Default)]
struct DocumentStoreInner {
    /// 打开时暂存的解码后内容，供 `read_document_content` 取回一次。
    pending_content: Option<(String, Vec<u8>)>,
    /// 与 `pending_content` 同属一次候选打开；内容成功取回前不得替换当前可信文档。
    pending_document: Option<(String, TrustedDocument)>,
    /// 当前已打开文档的可信元数据，供保存按 id 解析。
    active: Option<(String, TrustedDocument)>,
}

/// 单标签会话下的后端文档状态：同时维护打开内容缓冲与可信保存元数据。
#[derive(Default)]
pub struct DocumentStore {
    inner: Mutex<DocumentStoreInner>,
}

impl DocumentStore {
    fn store_open(&self, id: String, content: Vec<u8>, document: TrustedDocument) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        guard.pending_content = Some((id.clone(), content));
        guard.pending_document = Some((id, document));
    }

    fn take_content(&self, id: &str) -> Option<Vec<u8>> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let content_matches = guard
            .pending_content
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id);
        let document_matches = guard
            .pending_document
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id);
        if !content_matches || !document_matches {
            return None;
        }

        let (_, bytes) = guard
            .pending_content
            .take()
            .expect("matching pending content must exist");
        let pending = guard
            .pending_document
            .take()
            .expect("matching pending document must exist");
        guard.active = Some(pending);
        Some(bytes)
    }

    fn active_for(&self, id: &str) -> Option<TrustedDocument> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        guard
            .active
            .as_ref()
            .filter(|(stored_id, _)| stored_id == id)
            .map(|(_, document)| document.clone())
    }

    fn update_active(&self, id: &str, fingerprint: FileFingerprint, byte_count: u64) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if let Some((stored_id, document)) = guard.active.as_mut() {
            if stored_id == id {
                document.fingerprint = fingerprint;
                document.byte_count = byte_count;
            }
        }
    }
}

fn trusted_from_descriptor(descriptor: &DocumentDescriptor) -> TrustedDocument {
    TrustedDocument {
        path: descriptor.path.clone(),
        display_name: descriptor.display_name.clone(),
        encoding: descriptor.encoding,
        line_ending: descriptor.line_ending,
        fingerprint: descriptor.fingerprint.clone(),
        byte_count: descriptor.byte_count,
        read_only: descriptor.read_only,
    }
}

fn open_selected_path(
    path: &std::path::Path,
    store: &DocumentStore,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    let opened = document::open_document(path).map_err(DocumentCommandError::from_open_core)?;
    let trusted = trusted_from_descriptor(&opened.descriptor);
    store.store_open(
        opened.descriptor.id.clone(),
        opened.content.into_bytes(),
        trusted,
    );
    Ok(opened.descriptor)
}

/// 在 Rust 侧显示系统文件对话框并读取用户实际选择的文件。前端不传入路径，
/// 因而该命令不能被用作任意路径读取接口。取消选择返回 `None`。
#[tauri::command]
pub async fn select_and_open_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, DocumentStore>,
) -> Result<Option<DocumentDescriptor>, DocumentCommandError> {
    let Some(selected) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "selected file path is unavailable",
        )
    })?;
    open_selected_path(&path, state.inner()).map(Some)
}

/// 以原始二进制返回最近一次打开的文档内容。文档 ID 必须与打开时一致；取出后缓冲即清空。
#[tauri::command]
pub fn read_document_content(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<tauri::ipc::Response, DocumentCommandError> {
    match state.take_content(&id) {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err(DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "no buffered content is available for the requested document",
        )),
    }
}

/// 把当前内容保存回已打开文档的原路径。内容经 Raw body 传输、文档 id 经
/// [`DOCUMENT_ID_HEADER`] header 传输；后端按 id 解析可信路径与元数据，前端不得
/// 提交任意路径或自定指纹。成功后更新指纹与字节数并返回新的描述符。
#[tauri::command]
pub async fn save_document(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, DocumentStore>,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    let id = request
        .headers()
        .get(DOCUMENT_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::UnknownDocument,
                "save request is missing the document id header",
            )
        })?;

    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        _ => {
            return Err(DocumentCommandError::new(
                DocumentErrorCode::ReadFailed,
                "save content must be sent as a raw byte body",
            ));
        }
    };
    let content = std::str::from_utf8(bytes).map(str::to_owned).map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::UnsupportedEncoding,
            "save content is not valid UTF-8",
        )
    })?;

    let trusted = state.active_for(&id).ok_or_else(|| {
        DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "unknown or stale document id",
        )
    })?;

    let save_input = trusted.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        document::save_document(
            &save_input.path,
            document::SaveRequest {
                content: &content,
                encoding: save_input.encoding,
                line_ending: save_input.line_ending,
                original_fingerprint: &save_input.fingerprint,
                read_only: save_input.read_only,
            },
        )
    })
    .await
    .map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::SaveFailed,
            "save worker could not complete",
        )
    })?
    .map_err(DocumentCommandError::from_save_core)?;

    state.update_active(&id, outcome.fingerprint.clone(), outcome.byte_count);

    Ok(trusted.to_descriptor(&id, outcome.fingerprint, outcome.byte_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_open_core_maps_variants_to_stable_codes() {
        assert!(matches!(
            DocumentCommandError::from_open_core(DocumentError::SizeLimitExceeded {
                size: 1,
                limit: 0
            })
            .code,
            DocumentErrorCode::FileTooLarge
        ));
        assert!(matches!(
            DocumentCommandError::from_open_core(DocumentError::InvalidEncoding).code,
            DocumentErrorCode::UnsupportedEncoding
        ));
        assert!(matches!(
            DocumentCommandError::from_open_core(DocumentError::ChangedDuringRead).code,
            DocumentErrorCode::ChangedDuringRead
        ));
        assert!(matches!(
            DocumentCommandError::from_open_core(DocumentError::Io(std::io::Error::other("x")))
                .code,
            DocumentErrorCode::ReadFailed
        ));
    }

    #[test]
    fn from_save_core_maps_variants_to_stable_codes() {
        assert!(matches!(
            DocumentCommandError::from_save_core(DocumentError::ReadOnly).code,
            DocumentErrorCode::ReadOnly
        ));
        assert!(matches!(
            DocumentCommandError::from_save_core(DocumentError::MixedLineEndingNotChosen).code,
            DocumentErrorCode::MixedLineEnding
        ));
        assert!(matches!(
            DocumentCommandError::from_save_core(DocumentError::SaveConflict).code,
            DocumentErrorCode::SaveConflict
        ));
        assert!(matches!(
            DocumentCommandError::from_save_core(DocumentError::EncodingAmbiguous).code,
            DocumentErrorCode::EncodingAmbiguous
        ));
        assert!(matches!(
            DocumentCommandError::from_save_core(DocumentError::Io(std::io::Error::other("x")))
                .code,
            DocumentErrorCode::SaveFailed
        ));
    }

    #[test]
    fn unencodable_error_carries_character_and_offset() {
        let err = DocumentCommandError::from_save_core(DocumentError::UnencodableContent {
            character: '😀',
            byte_offset: 12,
        });
        assert!(matches!(err.code, DocumentErrorCode::UnencodableContent));
        assert_eq!(err.character.as_deref(), Some("😀"));
        assert_eq!(err.byte_offset, Some(12));
    }

    #[test]
    fn core_error_mapping_does_not_leak_internal_io_detail_into_message() {
        let err = DocumentCommandError::from_save_core(DocumentError::Io(std::io::Error::other(
            "secret-path.txt: permission denied",
        )));
        assert!(!err.message.contains("secret-path.txt"));
    }

    #[test]
    fn document_store_serves_content_once_and_keeps_metadata_for_save() {
        let store = DocumentStore::default();
        let descriptor = DocumentDescriptor {
            id: "doc-1".to_owned(),
            path: PathBuf::from("/tmp/sample.txt"),
            display_name: "sample.txt".to_owned(),
            byte_count: 3,
            encoding: TextEncoding::Utf8 { bom: false },
            line_ending: LineEnding::Lf,
            fingerprint: FileFingerprint {
                size_bytes: 3,
                sha256: "abc".to_owned(),
            },
            read_only: false,
        };
        let trusted = trusted_from_descriptor(&descriptor);
        store.store_open("doc-1".to_owned(), vec![b'x'; 3], trusted);

        // 内容尚未取回时只是候选打开，不能提前替换当前可信文档。
        assert!(store.active_for("doc-1").is_none());

        // 内容缓冲按 id 取出一次，并在同一临界区提升为当前可信文档。
        assert_eq!(store.take_content("doc-1"), Some(vec![b'x'; 3]));
        assert!(store.take_content("doc-1").is_none());

        // 元数据仍可用于保存。
        let active = store.active_for("doc-1").unwrap();
        assert_eq!(active.path, PathBuf::from("/tmp/sample.txt"));

        // 新候选内容取回失败时，旧文档仍可保存；只有正确 id 取回成功后才替换。
        let next_descriptor = DocumentDescriptor {
            id: "doc-next".to_owned(),
            path: PathBuf::from("/tmp/next.txt"),
            display_name: "next.txt".to_owned(),
            ..descriptor.clone()
        };
        store.store_open(
            "doc-next".to_owned(),
            b"next".to_vec(),
            trusted_from_descriptor(&next_descriptor),
        );
        assert!(store.active_for("doc-1").is_some());
        assert!(store.active_for("doc-next").is_none());
        assert!(store.take_content("wrong-id").is_none());
        assert!(store.active_for("doc-1").is_some());
        assert_eq!(store.take_content("doc-next"), Some(b"next".to_vec()));
        assert!(store.active_for("doc-1").is_none());
        assert!(store.active_for("doc-next").is_some());

        // 未知/过期 id 被拒绝。
        assert!(store.active_for("stale-doc").is_none());
    }

    #[test]
    fn document_store_updates_fingerprint_after_save() {
        let store = DocumentStore::default();
        let descriptor = DocumentDescriptor {
            id: "doc-2".to_owned(),
            path: PathBuf::from("/tmp/again.txt"),
            display_name: "again.txt".to_owned(),
            byte_count: 3,
            encoding: TextEncoding::Utf8 { bom: false },
            line_ending: LineEnding::Lf,
            fingerprint: FileFingerprint {
                size_bytes: 3,
                sha256: "old".to_owned(),
            },
            read_only: false,
        };
        store.store_open(
            "doc-2".to_owned(),
            Vec::new(),
            trusted_from_descriptor(&descriptor),
        );
        assert_eq!(store.take_content("doc-2"), Some(Vec::new()));

        store.update_active(
            "doc-2",
            FileFingerprint {
                size_bytes: 5,
                sha256: "new".to_owned(),
            },
            5,
        );

        let active = store.active_for("doc-2").unwrap();
        assert_eq!(active.byte_count, 5);
        assert_eq!(active.fingerprint.sha256, "new");

        // 过期 id 的更新不生效。
        store.update_active(
            "stale",
            FileFingerprint {
                size_bytes: 9,
                sha256: "x".to_owned(),
            },
            9,
        );
        assert_eq!(store.active_for("doc-2").unwrap().byte_count, 5);
    }
}
