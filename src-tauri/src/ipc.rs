//! 文档核心的受限 Tauri 命令层。
//!
//! 这些命令把内部 [`document`] 能力以最小方式暴露给前端：元数据走小型 JSON 响应，
//! Unicode 内容走原始二进制响应（`Vec<u8>` → `ipc::Response`），避免把大文本编码为
//! JSON 数字数组或大字符串。错误以稳定代码返回，前端据此映射用户可理解的提示，
//! 不展示 Rust 内部调试文本。

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

use crate::document::{self, DocumentDescriptor, DocumentError};

/// 稳定、面向前端的错误代码。新增代码即视为公共契约变更。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DocumentErrorCode {
    FileTooLarge,
    UnsupportedEncoding,
    ChangedDuringRead,
    ReadFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenError {
    pub code: DocumentErrorCode,
    /// 通用安全描述，仅供诊断；前端展示文案由 `code` 决定，不向用户呈现此字段。
    pub message: String,
}

impl DocumentOpenError {
    fn new(code: DocumentErrorCode, message: &str) -> Self {
        Self {
            code,
            message: message.to_owned(),
        }
    }

    fn from_core(err: DocumentError) -> Self {
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
            DocumentError::Io(_) => {
                Self::new(DocumentErrorCode::ReadFailed, "file could not be read")
            }
            // 以下变体属于保存路径，打开流程不可达；保持穷尽匹配以防回归。
            DocumentError::ReadOnly => Self::new(
                DocumentErrorCode::ReadFailed,
                "unexpected save-side error during open",
            ),
            DocumentError::MixedLineEndingNotChosen => Self::new(
                DocumentErrorCode::ReadFailed,
                "unexpected save-side error during open",
            ),
            DocumentError::UnencodableContent { .. } => Self::new(
                DocumentErrorCode::ReadFailed,
                "unexpected save-side error during open",
            ),
            DocumentError::SaveConflict => Self::new(
                DocumentErrorCode::ReadFailed,
                "unexpected save-side error during open",
            ),
            DocumentError::EncodingAmbiguous => Self::new(
                DocumentErrorCode::ReadFailed,
                "unexpected save-side error during open",
            ),
        }
    }
}

/// 最近一次成功打开的内容缓冲。`open_document` 在此暂存解码后的 UTF-8 字节，
/// `read_document_content` 以文档 ID 校验后取出并以原始字节返回。
///
/// 单标签会话下仅保留最近一次打开；新打开会覆盖旧缓冲。
#[derive(Default)]
pub struct OpenBuffer {
    current: Mutex<Option<(String, Vec<u8>)>>,
}

impl OpenBuffer {
    fn store(&self, id: String, bytes: Vec<u8>) {
        *self.current.lock().expect("open buffer lock poisoned") = Some((id, bytes));
    }

    fn take_for(&self, id: &str) -> Option<Vec<u8>> {
        let mut current = self.current.lock().expect("open buffer lock poisoned");
        if current
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id)
        {
            current.take().map(|(_, bytes)| bytes)
        } else {
            None
        }
    }
}

fn open_selected_path(
    path: &Path,
    buffer: &OpenBuffer,
) -> Result<DocumentDescriptor, DocumentOpenError> {
    let opened = document::open_document(path).map_err(DocumentOpenError::from_core)?;
    let bytes = opened.content.into_bytes();
    buffer.store(opened.descriptor.id.clone(), bytes);
    Ok(opened.descriptor)
}

/// 在 Rust 侧显示系统文件对话框并读取用户实际选择的文件。前端不传入路径，
/// 因而该命令不能被用作任意路径读取接口。取消选择返回 `None`。
#[tauri::command]
pub async fn select_and_open_document(
    app: tauri::AppHandle,
    state: tauri::State<'_, OpenBuffer>,
) -> Result<Option<DocumentDescriptor>, DocumentOpenError> {
    let Some(selected) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| {
        DocumentOpenError::new(
            DocumentErrorCode::ReadFailed,
            "selected file path is unavailable",
        )
    })?;
    open_selected_path(&path, state.inner()).map(Some)
}

/// 以原始二进制返回最近一次打开的文档内容。文档 ID 必须与 [`open_document`]
/// 返回的一致；取出后缓冲即清空，避免内容在前端以外的地方长期驻留。
#[tauri::command]
pub fn read_document_content(
    id: String,
    state: tauri::State<'_, OpenBuffer>,
) -> Result<tauri::ipc::Response, DocumentOpenError> {
    match state.take_for(&id) {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err(DocumentOpenError::new(
            DocumentErrorCode::ReadFailed,
            "no buffered content is available for the requested document",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_core_maps_each_variant_to_a_stable_code() {
        assert!(matches!(
            DocumentOpenError::from_core(DocumentError::SizeLimitExceeded { size: 1, limit: 0 })
                .code,
            DocumentErrorCode::FileTooLarge
        ));
        assert!(matches!(
            DocumentOpenError::from_core(DocumentError::InvalidEncoding).code,
            DocumentErrorCode::UnsupportedEncoding
        ));
        assert!(matches!(
            DocumentOpenError::from_core(DocumentError::ChangedDuringRead).code,
            DocumentErrorCode::ChangedDuringRead
        ));
        assert!(matches!(
            DocumentOpenError::from_core(DocumentError::Io(std::io::Error::other("x"))).code,
            DocumentErrorCode::ReadFailed
        ));
    }

    #[test]
    fn from_core_does_not_leak_internal_io_detail_into_message() {
        let err = DocumentOpenError::from_core(DocumentError::Io(std::io::Error::other(
            "secret-path.txt: permission denied",
        )));
        assert!(!err.message.contains("secret-path.txt"));
    }

    #[test]
    fn open_buffer_only_clears_content_for_the_matching_id() {
        let buffer = OpenBuffer::default();
        buffer.store("doc-1".to_owned(), vec![b'x']);

        assert!(buffer.take_for("stale-doc").is_none());
        assert_eq!(buffer.take_for("doc-1"), Some(vec![b'x']));
        assert!(buffer.take_for("doc-1").is_none());
    }
}
