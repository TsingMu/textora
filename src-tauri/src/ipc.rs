//! 文档核心的受限 Tauri 命令层。
//!
//! 这些命令把内部 [`document`] 能力以最小方式暴露给前端：元数据走小型 JSON 响应，
//! Unicode 内容走原始二进制——打开经 `ipc::Response` 返回、保存经 `ipc::Request` 的
//! Raw body 与自定义 header 接收，避免把大文本编码为 JSON 数字数组或大字符串。错误
//! 以稳定代码返回，前端据此映射用户可理解的提示，不展示 Rust 内部调试文本。

use std::fs::File;
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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
    SaveConflictContentChanged,
    SaveConflictTargetMissing,
    SaveFailed,
    /// 前端提交的文档 id 后端未知或已过期（如新建文档、被新打开覆盖）。
    UnknownDocument,
    // 内嵌另存为目标契约
    /// 前端提交的文件名不合法（空、含路径分隔符或 `.`/`..`、含 NUL 等）。
    InvalidFileName,
    /// 目录授权 id 未知或已过期（未发放、被替换，或因文档切换/关闭/成功落盘而清除）。
    MissingGrant,
    /// 目录授权 id 有效但不归属当前请求的文档。
    GrantMismatch,
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
#[derive(Debug, Clone)]
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

/// 普通保存冲突的分类：磁盘内容已变化 vs 目标已缺失。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConflictKind {
    ContentChanged,
    TargetMissing,
}

/// 待解决的冲突状态，绑定当前活动文档 id。持有冲突发生时的完整编辑快照和可信描述信息，
/// 供后续重新加载、强制覆盖或缺失处理操作使用。前端不能提交路径、指纹或冲突类型。
#[derive(Debug, Clone)]
struct ConflictState {
    revision: u64,
    kind: ConflictKind,
    // 当前重新加载/取消切片不读取编辑快照；紧随其后的强制覆盖切片会消费它。
    #[allow(dead_code)]
    snapshot: Vec<u8>,
    trusted: TrustedDocument,
}

/// 目录授权描述符：前端只持不透明 `id` 与只读 `display_name`，从不接触真实路径。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDirectoryGrant {
    pub id: String,
    pub display_name: String,
}

/// 内嵌另存为面板的默认目标草稿：默认文件名 + 可选默认目录授权（已有文档用其父目录）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAsDraft {
    pub file_name: String,
    pub directory: Option<SaveDirectoryGrant>,
}

/// 目标预览：`dir/file_name` 是否已存在、是否即当前活动文档原路径。用于"替换确认"。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetPreview {
    pub exists: bool,
    pub is_current_path: bool,
}

/// 用户经 `pick_save_directory` 或 `prepare_save_as`（已有文档默认父目录）授权的保存目录。
/// 绑定单一活动文档；切换/关闭/成功落盘后清除。前端只持 `grant_id`，无法伪造路径。
#[derive(Debug, Clone)]
struct PendingSaveDirectory {
    grant_id: String,
    /// Grant 发放时绑定的活动文档 id；Untitled 首次保存为 `None`。
    document_id: Option<String>,
    path: PathBuf,
}

#[derive(Default)]
struct DocumentStoreInner {
    /// 打开时暂存的解码后内容，供 `read_document_content` 取回一次。
    pending_content: Option<(String, Vec<u8>)>,
    /// 与 `pending_content` 同属一次候选打开；内容成功取回前不得替换当前可信文档。
    pending_document: Option<(String, TrustedDocument)>,
    /// 重新加载候选绑定的冲突版本；普通打开候选为 `None`。
    pending_reload_revision: Option<(String, u64)>,
    /// 当前已打开文档的可信元数据，供保存按 id 解析。
    active: Option<(String, TrustedDocument)>,
    /// 当前活动文档的待解决冲突状态。
    conflict: Option<ConflictState>,
    /// 正在执行的强制覆盖，绑定活动文档与冲突版本。租约存在期间其他冲突解决操作
    /// 必须拒绝，避免取消或新操作使已经确认的破坏性写入失去状态归属。
    pending_overwrite: Option<(String, u64)>,
    /// 单调递增的内部冲突版本，只在 Rust 可信状态中使用，不暴露给前端。
    next_conflict_revision: u64,
    /// 用户授权的内嵌另存为保存目录（绑定活动文档）。切换/关闭/成功落盘后清除。
    pending_save_directory: Option<PendingSaveDirectory>,
    /// 单调递增的目录授权 id 计数器，只在内嵌另存为契约内部使用。
    next_save_directory_id: u64,
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
        guard.pending_reload_revision = None;
        // 新文档载入即废弃任何旧文档的保存目录授权，避免跨文档落盘。
        guard.pending_save_directory = None;
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
        let reload_matches = match guard.pending_reload_revision.as_ref() {
            None => true,
            Some((reload_id, revision)) => {
                reload_id == id
                    && guard.conflict.as_ref().is_some_and(|conflict| {
                        conflict.revision == *revision
                            && conflict.kind == ConflictKind::ContentChanged
                    })
            }
        };
        let overwrite_allows_promotion = guard.pending_overwrite.is_none();
        if !content_matches || !document_matches || !reload_matches || !overwrite_allows_promotion {
            if content_matches && document_matches {
                guard.pending_content = None;
                guard.pending_document = None;
                guard.pending_reload_revision = None;
            }
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
        guard.pending_reload_revision = None;
        guard.active = Some(pending);
        guard.conflict = None;
        guard.pending_save_directory = None;
        Some(bytes)
    }

    fn active_for(&self, id: &str) -> Option<TrustedDocument> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        if guard.pending_overwrite.is_some() {
            return None;
        }
        guard
            .active
            .as_ref()
            .filter(|(stored_id, _)| stored_id == id)
            .map(|(_, document)| document.clone())
    }

    fn update_active(&self, id: &str, fingerprint: FileFingerprint, byte_count: u64) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if guard.pending_overwrite.is_some() {
            return;
        }
        if let Some((stored_id, document)) = guard.active.as_mut() {
            if stored_id == id {
                document.fingerprint = fingerprint;
                document.byte_count = byte_count;
                guard.conflict = None;
            }
        }
    }

    /// 另存为成功：把当前可信文档关联到新目标（路径/显示名/编码/换行/指纹/字节数/只读），
    /// 沿用同一文档 id。id 不匹配时无操作（调用方应在已知 id 上调用）。
    fn reassociate_active(&self, id: &str, document: TrustedDocument) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if let Some((stored_id, existing)) = guard.active.as_mut() {
            if stored_id == id {
                *existing = document;
                guard.conflict = None;
            }
        }
    }

    /// 首次保存成功：生成新文档 id 并建立可信关联，返回该 id。
    fn create_active(&self, document: TrustedDocument) -> String {
        let id = crate::document::next_document_id();
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        guard.active = Some((id.clone(), document));
        guard.conflict = None;
        guard.pending_save_directory = None;
        id
    }

    /// 普通保存冲突时记录待解决冲突状态。必须绑定当前活动文档 id，否则视为过期不记录。
    /// 首次冲突不得更新可信指纹、字节数或描述信息——此处只记录状态，不修改 active。
    fn record_conflict(&self, id: &str, kind: ConflictKind, snapshot: Vec<u8>) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if guard.pending_overwrite.is_some() {
            return;
        }
        let trusted = guard
            .active
            .as_ref()
            .filter(|(stored_id, _)| stored_id == id)
            .map(|(_, trusted)| trusted.clone());
        if let Some(trusted) = trusted {
            guard.next_conflict_revision = guard.next_conflict_revision.wrapping_add(1);
            let revision = guard.next_conflict_revision;
            guard.conflict = Some(ConflictState {
                revision,
                kind,
                snapshot,
                trusted,
            });
        }
    }

    /// 测试辅助：读取但不消费当前冲突。真实解决命令必须在成功或明确取消后才清除状态，
    /// 不能在可能失败的文件 I/O 之前把冲突标记为已解决。
    #[cfg(test)]
    fn conflict_for(&self, id: &str) -> Option<ConflictState> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        let active_matches = guard
            .active
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id);
        if !active_matches {
            return None;
        }
        guard.conflict.clone()
    }

    /// 取得当前活动文档的内容变化冲突。返回内部快照但不消费状态；重新加载失败时
    /// 用户仍可重试或取消。目标缺失冲突必须走独立的保留/关闭流程。
    fn content_conflict_for(&self, id: &str) -> Option<ConflictState> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        let active_matches = guard
            .active
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id);
        if !active_matches {
            return None;
        }
        guard
            .conflict
            .as_ref()
            .filter(|conflict| conflict.kind == ConflictKind::ContentChanged)
            .cloned()
    }

    /// 明确取消当前活动文档的内容变化冲突。不执行文件 I/O，不影响活动文档或内容。
    /// 未知、过期、已解决或其他类型的冲突返回 false。
    fn clear_content_conflict(&self, id: &str) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let active_matches = guard
            .active
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id);
        let revision = guard.conflict.as_ref().and_then(|conflict| {
            (active_matches && conflict.kind == ConflictKind::ContentChanged)
                .then_some(conflict.revision)
        });
        let Some(revision) = revision else {
            return false;
        };
        if guard
            .pending_overwrite
            .as_ref()
            .is_some_and(|(pending_id, pending_revision)| {
                pending_id == id && *pending_revision == revision
            })
        {
            return false;
        }

        guard.conflict = None;
        if guard
            .pending_reload_revision
            .as_ref()
            .is_some_and(|(pending_id, pending_revision)| {
                pending_id == id && *pending_revision == revision
            })
        {
            guard.pending_content = None;
            guard.pending_document = None;
            guard.pending_reload_revision = None;
        }
        true
    }

    /// 为当前内容冲突取得强制覆盖租约。快照在租约建立后返回，失败或成功提交前都不消费
    /// 冲突；同一时刻只允许一个覆盖操作。
    fn begin_overwrite(&self, id: &str) -> Option<ConflictState> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if guard.pending_overwrite.is_some() || guard.pending_reload_revision.is_some() {
            return None;
        }
        let active_matches = guard
            .active
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id);
        let conflict = guard
            .conflict
            .as_ref()
            .filter(|conflict| active_matches && conflict.kind == ConflictKind::ContentChanged)
            .cloned()?;
        guard.pending_overwrite = Some((id.to_owned(), conflict.revision));
        Some(conflict)
    }

    /// 覆盖 I/O 失败时仅释放匹配租约，保留原冲突供用户重试或取消。
    fn abort_overwrite(&self, id: &str, revision: u64) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let matches =
            guard
                .pending_overwrite
                .as_ref()
                .is_some_and(|(pending_id, pending_revision)| {
                    pending_id == id && *pending_revision == revision
                });
        if matches {
            guard.pending_overwrite = None;
        }
        matches
    }

    /// 覆盖成功后，在同一锁内复核活动文档、冲突版本与租约，再更新可信状态并清除冲突。
    fn commit_overwrite(
        &self,
        id: &str,
        revision: u64,
        fingerprint: FileFingerprint,
        byte_count: u64,
    ) -> Option<TrustedDocument> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let still_current = guard
            .active
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id)
            && guard.conflict.as_ref().is_some_and(|conflict| {
                conflict.revision == revision && conflict.kind == ConflictKind::ContentChanged
            })
            && guard
                .pending_overwrite
                .as_ref()
                .is_some_and(|(pending_id, pending_revision)| {
                    pending_id == id && *pending_revision == revision
                });
        if !still_current {
            return None;
        }

        let (_, document) = guard
            .active
            .as_mut()
            .expect("matching active document must exist");
        document.fingerprint = fingerprint;
        document.byte_count = byte_count;
        let updated = document.clone();
        guard.conflict = None;
        guard.pending_overwrite = None;
        Some(updated)
    }

    /// 重新加载成功后，把新内容和更新后的可信描述缓冲为候选，供 `read_document_content`
    /// 取回。取回时 `take_content` 会原子提升为活动文档并清除冲突状态——因此冲突状态
    /// 在内容被前端成功取回前不会被标记为已解决。
    fn prepare_reload(
        &self,
        id: &str,
        revision: u64,
        content: Vec<u8>,
        document: TrustedDocument,
    ) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let still_current = guard
            .active
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id)
            && guard.conflict.as_ref().is_some_and(|conflict| {
                conflict.revision == revision && conflict.kind == ConflictKind::ContentChanged
            })
            && guard.pending_overwrite.is_none();
        if !still_current {
            return false;
        }
        guard.pending_content = Some((id.to_owned(), content));
        guard.pending_document = Some((id.to_owned(), document));
        guard.pending_reload_revision = Some((id.to_owned(), revision));
        true
    }

    /// 返回活动文档的可信路径（不读取内容）。用于聚焦时检查文件是否仍存在。
    fn active_path_for(&self, id: &str) -> Option<PathBuf> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        guard
            .active
            .as_ref()
            .filter(|(stored_id, _)| stored_id == id)
            .map(|(_, document)| document.path.clone())
    }

    /// 关闭文档：清除活动文档关联与所有待解决/待提交状态。未知 id 返回 false。
    fn close_active(&self, id: &str) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let active_matches = guard
            .active
            .as_ref()
            .is_some_and(|(stored_id, _)| stored_id == id);
        if active_matches {
            guard.active = None;
            guard.conflict = None;
            guard.pending_overwrite = None;
            guard.pending_reload_revision = None;
            guard.pending_content = None;
            guard.pending_document = None;
            guard.pending_save_directory = None;
        }
        active_matches
    }

    /// 发放一个新的保存目录授权（覆盖任何既有授权），返回面向前端的授权描述符。
    fn establish_save_grant(
        &self,
        document_id: Option<String>,
        path: PathBuf,
        display_name: String,
    ) -> Result<SaveDirectoryGrant, DocumentCommandError> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let context_matches = match document_id.as_deref() {
            Some(requested_id) => {
                guard.pending_overwrite.is_none()
                    && guard
                        .active
                        .as_ref()
                        .is_some_and(|(active_id, _)| active_id == requested_id)
            }
            None => guard.active.is_none(),
        };
        if !context_matches {
            return Err(DocumentCommandError::new(
                DocumentErrorCode::UnknownDocument,
                "save directory grant cannot be attached to a stale document context",
            ));
        }
        let id = format!("save-dir-{}", guard.next_save_directory_id);
        guard.next_save_directory_id = guard.next_save_directory_id.saturating_add(1);
        guard.pending_save_directory = Some(PendingSaveDirectory {
            grant_id: id.clone(),
            document_id,
            path,
        });
        Ok(SaveDirectoryGrant { id, display_name })
    }

    fn clear_save_grant(&self) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        guard.pending_save_directory = None;
    }

    /// 读取匹配 `grant_id` 的授权（克隆）。不存在或已过期返回 `None`。
    fn current_save_grant(&self, grant_id: &str) -> Option<PendingSaveDirectory> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        guard
            .pending_save_directory
            .as_ref()
            .filter(|g| g.grant_id == grant_id)
            .cloned()
    }

    /// 成功落盘后消费授权（单次使用）。id 不匹配时不做任何事。
    fn take_save_grant(&self, grant_id: &str) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if guard
            .pending_save_directory
            .as_ref()
            .is_some_and(|g| g.grant_id == grant_id)
        {
            guard.pending_save_directory = None;
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
    let snapshot = content.clone();
    let core_result = tauri::async_runtime::spawn_blocking(move || {
        document::save_document(
            &save_input.path,
            document::SaveRequest {
                content,
                encoding: save_input.encoding,
                line_ending: save_input.line_ending,
                target: document::SaveTarget::InPlace {
                    source_read_only: save_input.read_only,
                    expected: save_input.fingerprint.clone(),
                },
            },
        )
    })
    .await
    .map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::SaveFailed,
            "save worker could not complete",
        )
    })?;

    match core_result {
        Ok(outcome) => {
            state.update_active(&id, outcome.fingerprint.clone(), outcome.byte_count);
            Ok(trusted.to_descriptor(&id, outcome.fingerprint, outcome.byte_count))
        }
        Err(DocumentError::SaveConflict) => {
            // 普通保存冲突：分类并记录待解决冲突状态（不更新指纹/字节数/描述信息，不清脏）。
            let kind =
                classify_conflict(&trusted.path).map_err(DocumentCommandError::from_save_core)?;
            state.record_conflict(&id, kind, snapshot.into_bytes());
            Err(DocumentCommandError::new(
                conflict_error_code(kind),
                "save conflict detected",
            ))
        }
        Err(other) => Err(DocumentCommandError::from_save_core(other)),
    }
}

/// 取消当前内容变化冲突。消费待解决冲突状态（标记为已解决），不执行任何文件 I/O。
/// 未知、过期、已解决或其他类型的冲突明确拒绝，不清除不属于该请求的状态。
#[tauri::command]
pub fn cancel_conflict(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<(), DocumentCommandError> {
    if state.clear_content_conflict(&id) {
        Ok(())
    } else {
        Err(DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "no pending content conflict for this document",
        ))
    }
}

/// 从后端可信路径重新加载磁盘内容以解决内容变化冲突。
///
/// 读取磁盘快照（复用 `open_document` 的一致读取、编码检测与指纹），成功后缓冲新内容
/// 供 `read_document_content` 取回（取回时原子提升活动文档并清除冲突）。读取失败时
/// 冲突状态保持待解决，用户可重试或取消。
#[tauri::command]
pub async fn reload_from_conflict(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    let conflict = state.content_conflict_for(&id).ok_or_else(|| {
        DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "no pending content conflict for this document",
        )
    })?;

    let revision = conflict.revision;
    let path = conflict.trusted.path.clone();

    let opened = tauri::async_runtime::spawn_blocking(move || document::open_document(&path))
        .await
        .map_err(|_| {
            DocumentCommandError::new(
                DocumentErrorCode::SaveFailed,
                "reload worker could not complete",
            )
        })?
        .map_err(DocumentCommandError::from_open_core)?;

    // 构建更新后的可信描述：路径/显示名不变，指纹/编码/换行/字节数/只读以新快照为准。
    let mut updated = conflict.trusted;
    updated.encoding = opened.descriptor.encoding;
    updated.line_ending = opened.descriptor.line_ending;
    updated.fingerprint = opened.descriptor.fingerprint.clone();
    updated.byte_count = opened.descriptor.byte_count;
    updated.read_only = opened.descriptor.read_only;

    // 缓冲新内容为候选，供 read_document_content 取回并原子提升（清除冲突）。
    if !state.prepare_reload(&id, revision, opened.content.into_bytes(), updated.clone()) {
        return Err(DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "content conflict changed while the file was being reloaded",
        ));
    }

    Ok(updated.to_descriptor(&id, updated.fingerprint.clone(), updated.byte_count))
}

/// 用户明确确认后，以冲突时保留的完整编辑快照覆盖确认后的最新磁盘基线。
///
/// 重新观测目标取得当前指纹作为覆盖基线（前端不能提供），再以 `ExistingTarget` 写入，
/// 复用严格编码、换行规范化、50 MiB 限制、只读/权限检查、同目录临时文件与原子替换。
/// 确认后到替换前若目标再次变化或消失，覆盖被拒绝，冲突状态保持待解决。成功后清除冲突
/// 并更新可信指纹与字节数。只接受 `ContentChanged` 冲突。
#[tauri::command]
pub async fn force_overwrite(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    force_overwrite_inner(id, state.inner()).await
}

async fn force_overwrite_inner(
    id: String,
    state: &DocumentStore,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    let conflict = state.begin_overwrite(&id).ok_or_else(|| {
        DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "no available content conflict for this document",
        )
    })?;
    let revision = conflict.revision;
    let snapshot = String::from_utf8(conflict.snapshot.clone()).map_err(|_| {
        state.abort_overwrite(&id, revision);
        DocumentCommandError::new(
            DocumentErrorCode::SaveFailed,
            "conflict snapshot is not valid UTF-8",
        )
    })?;
    let trusted = conflict.trusted.clone();

    let core_result = tauri::async_runtime::spawn_blocking(move || {
        // 确认后重新观测目标取得覆盖基线（前端不能提供或修改）。
        let observed = read_target_fingerprint(&trusted.path)?;
        document::save_document(
            &trusted.path,
            document::SaveRequest {
                content: snapshot,
                encoding: trusted.encoding,
                line_ending: trusted.line_ending,
                target: document::SaveTarget::ExistingTarget { observed },
            },
        )
    })
    .await
    .map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::SaveFailed,
            "force-overwrite worker could not complete",
        )
    })
    .and_then(|result| result.map_err(DocumentCommandError::from_save_core));

    let outcome = match core_result {
        Ok(outcome) => outcome,
        Err(error) => {
            state.abort_overwrite(&id, revision);
            return Err(error);
        }
    };

    let Some(updated) = state.commit_overwrite(
        &id,
        revision,
        outcome.fingerprint.clone(),
        outcome.byte_count,
    ) else {
        state.abort_overwrite(&id, revision);
        return Err(DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "content conflict changed while the file was being overwritten",
        ));
    };
    Ok(updated.to_descriptor(&id, outcome.fingerprint, outcome.byte_count))
}

fn target_exists(path: &std::path::Path) -> Result<bool, DocumentError> {
    match std::fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(err) => Err(DocumentError::Io(err)),
    }
}

/// 检查当前活动文档的可信路径文件是否仍存在。只做 `metadata` 调用，不读取内容；
/// 仅 `NotFound` 表示缺失，其他 I/O 错误明确失败。未知或过期 id 返回 `true`，避免触发
/// 不属于当前会话的缺失提示。前端在窗口重新聚焦时调用。
#[tauri::command]
pub async fn check_target_exists(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<bool, DocumentCommandError> {
    let Some(path) = state.active_path_for(&id) else {
        return Ok(true);
    };
    tauri::async_runtime::spawn_blocking(move || target_exists(&path))
        .await
        .map_err(|_| {
            DocumentCommandError::new(
                DocumentErrorCode::ReadFailed,
                "target existence worker could not complete",
            )
        })?
        .map_err(DocumentCommandError::from_open_core)
}

/// 关闭文档：清除后端活动文档关联与待解决冲突状态。用于「保留」（解除路径关联后
/// 文档变为内存 Untitled）和「不保留」（关闭文档）两个分支。未知 id 明确拒绝，避免
/// 前端在后端状态未改变时提交本地会话转换。
#[tauri::command]
pub fn close_document(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<(), DocumentCommandError> {
    if state.close_active(&id) {
        Ok(())
    } else {
        Err(DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "unknown or stale document id",
        ))
    }
}

/// 保存格式 header 名。编码值：`utf8` / `utf8-bom` / `gbk`；换行值：`lf` / `crlf`。
const ENCODING_HEADER: &str = "textora-encoding";
const LINE_ENDING_HEADER: &str = "textora-line-ending";
/// 内嵌另存为契约 header 名：目录授权 id 与文件名（前端只回传 Rust 发放的 grant id）。
const DIRECTORY_ID_HEADER: &str = "textora-directory-id";
const FILE_NAME_HEADER: &str = "textora-file-name";

fn parse_encoding_header(
    headers: &tauri::http::HeaderMap,
) -> Result<TextEncoding, DocumentCommandError> {
    let value = headers
        .get(ENCODING_HEADER)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::UnsupportedEncoding,
                "save request is missing the encoding header",
            )
        })?;
    match value {
        "utf8" => Ok(TextEncoding::Utf8 { bom: false }),
        "utf8-bom" => Ok(TextEncoding::Utf8 { bom: true }),
        "gbk" => Ok(TextEncoding::Gbk),
        _ => Err(DocumentCommandError::new(
            DocumentErrorCode::UnsupportedEncoding,
            "unsupported save encoding",
        )),
    }
}

fn parse_line_ending_header(
    headers: &tauri::http::HeaderMap,
) -> Result<LineEnding, DocumentCommandError> {
    let value = headers
        .get(LINE_ENDING_HEADER)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::MixedLineEnding,
                "save request is missing the line-ending header",
            )
        })?;
    match value {
        "lf" => Ok(LineEnding::Lf),
        "crlf" => Ok(LineEnding::Crlf),
        _ => Err(DocumentCommandError::new(
            DocumentErrorCode::MixedLineEnding,
            "unsupported save line ending",
        )),
    }
}

/// 对话框返回后**首次观测**目标并据此选择 `SaveTarget`。
///
/// - 选择当前原路径（与可信源规范化后相等）→ `InPlace`，沿用打开指纹与源只读校验，不绕过冲突保护。
/// - 已存在的不同目标 → `ExistingTarget { observed }`，`observed` 为本次首次观测到的指纹。
/// - 不存在的目标 → `NewTarget`。
fn choose_save_target(
    path: &std::path::Path,
    trusted: Option<&TrustedDocument>,
) -> Result<crate::document::SaveTarget, DocumentError> {
    // 当前原路径即使已经缺失，也必须继续按 InPlace 路由，让核心报告冲突；否则先对
    // 目标 canonicalize 会把缺失原路径误判为可创建的新目标，绕过目标缺失保护。
    if let Some(trusted) = trusted {
        if path == trusted.path {
            return Ok(crate::document::SaveTarget::InPlace {
                source_read_only: trusted.read_only,
                expected: trusted.fingerprint.clone(),
            });
        }
    }

    let chosen = match std::fs::canonicalize(path) {
        Ok(resolved) => resolved,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(crate::document::SaveTarget::NewTarget);
        }
        Err(err) => return Err(DocumentError::Io(err)),
    };

    if let Some(trusted) = trusted {
        if let Ok(trusted_resolved) = std::fs::canonicalize(&trusted.path) {
            if chosen == trusted_resolved {
                return Ok(crate::document::SaveTarget::InPlace {
                    source_read_only: trusted.read_only,
                    expected: trusted.fingerprint.clone(),
                });
            }
        }
    }

    let observed = read_target_fingerprint(&chosen)?;
    Ok(crate::document::SaveTarget::ExistingTarget { observed })
}

/// 读取并计算目标的当前指纹（对话框返回后的首次观测）。
fn read_target_fingerprint(path: &std::path::Path) -> Result<FileFingerprint, DocumentError> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let bytes =
        crate::document::read_bounded(&mut file, len, crate::document::MAX_FILE_SIZE_BYTES)?;
    Ok(FileFingerprint::of(&bytes))
}

fn display_name_of(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".to_owned())
}

fn directory_display_name(path: &std::path::Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// 按可信路径当前是否存在分类普通保存冲突。目标存在但指纹不匹配→内容已变化；
/// 目标不存在→目标已缺失。此分类基于后端 Rust 的 `metadata` 调用，不依赖前端猜测。
fn classify_conflict(path: &std::path::Path) -> Result<ConflictKind, DocumentError> {
    match std::fs::metadata(path) {
        Ok(_) => Ok(ConflictKind::ContentChanged),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(ConflictKind::TargetMissing),
        Err(err) => Err(DocumentError::Io(err)),
    }
}

/// 把冲突分类映射到稳定错误代码。
fn conflict_error_code(kind: ConflictKind) -> DocumentErrorCode {
    match kind {
        ConflictKind::ContentChanged => DocumentErrorCode::SaveConflictContentChanged,
        ConflictKind::TargetMissing => DocumentErrorCode::SaveConflictTargetMissing,
    }
}

/// 新内嵌面板必须与当前 Rust 可信会话一致：有活动文档时必须提交其 id，Untitled
/// (`None`) 只在后端没有活动文档时成立。
fn trusted_for_inline_save_as(
    store: &DocumentStore,
    id: Option<&str>,
) -> Result<Option<TrustedDocument>, DocumentCommandError> {
    match id {
        Some(id) => store.active_for(id).map(Some).ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::UnknownDocument,
                "unknown or stale document id",
            )
        }),
        None if store
            .inner
            .lock()
            .expect("document store lock poisoned")
            .active
            .is_none() =>
        {
            Ok(None)
        }
        None => Err(DocumentCommandError::new(
            DocumentErrorCode::UnknownDocument,
            "untitled save context does not match the active document",
        )),
    }
}

/// Untitled 首次保存时建议的默认文件名。无扩展名：用户可在系统面板自行添加扩展名，
/// 不与本规格「不自动追加扩展名」冲突，且与会话显示名一致。
const UNTITLED_DEFAULT_FILE_NAME: &str = "Untitled";

/// 内嵌面板的默认目标：文件名 + 可选默认目录（已有文档用其父目录，仅当父目录可用）。
/// 纯函数（`is_dir` 触 FS，测试用 `TestDir` 提供真实目录）。
fn build_save_as_draft(trusted_opt: Option<&TrustedDocument>) -> (String, Option<PathBuf>) {
    match trusted_opt {
        Some(trusted) => {
            let dir = trusted
                .path
                .parent()
                .filter(|p| p.is_dir())
                .map(PathBuf::from);
            (trusted.display_name.clone(), dir)
        }
        None => (UNTITLED_DEFAULT_FILE_NAME.to_owned(), None),
    }
}

/// 校验前端提交的文件名是单个文件名分量：非空、无路径分隔符、非 `.`/`..`、不含 NUL。
/// 拒绝非单一分量，避免前端借文件名注入路径。
fn validate_file_name(name: &str) -> Result<(), DocumentErrorCode> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
        || std::path::Path::new(name).components().count() != 1
    {
        return Err(DocumentErrorCode::InvalidFileName);
    }
    Ok(())
}

/// Raw IPC 同时传输大文本时，文件名只能放在 header；为完整支持 Unicode 与字面 `%`，
/// 前端须按 UTF-8 percent-encoding（`encodeURIComponent`）提交。纯 ASCII 未转义值兼容。
fn decode_file_name_header(value: &str) -> Result<String, DocumentErrorCode> {
    fn hex(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        }
    }

    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let Some((high, low)) = bytes
                .get(index + 1)
                .zip(bytes.get(index + 2))
                .and_then(|(high, low)| Some((hex(*high)?, hex(*low)?)))
            else {
                return Err(DocumentErrorCode::InvalidFileName);
            };
            decoded.push((high << 4) | low);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).map_err(|_| DocumentErrorCode::InvalidFileName)
}

/// 把授权目录与已校验的文件名拼成绝对保存路径（纯函数，不做 I/O）。
fn compose_save_path(dir: &std::path::Path, file_name: &str) -> PathBuf {
    dir.join(file_name)
}

/// 复核授权是否归属请求的文档（首次保存 Untitled 用 `None`）。
fn grant_matches_document(grant: &PendingSaveDirectory, requested: Option<&str>) -> bool {
    grant.document_id.as_deref() == requested
}

/// 预览目标：判定 `dir/file_name` 是否存在、是否即当前活动文档原路径。不做写操作。
/// 文件名不合法返回 `InvalidFileName`；canonicalize 等错误视为"无法确认识别"。
fn preview_target(
    dir: &std::path::Path,
    file_name: &str,
    current: Option<&TrustedDocument>,
) -> Result<TargetPreview, DocumentErrorCode> {
    validate_file_name(file_name)?;
    let path = compose_save_path(dir, file_name);
    let exists = match std::fs::symlink_metadata(&path) {
        Ok(_) => true,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err(DocumentErrorCode::SaveFailed),
    };
    let is_current_path = match current {
        Some(trusted) => match (
            std::fs::canonicalize(&trusted.path),
            std::fs::canonicalize(&path),
        ) {
            (Ok(current_canon), Ok(target_canon)) => current_canon == target_canon,
            _ => false,
        },
        None => false,
    };
    Ok(TargetPreview {
        exists,
        is_current_path,
    })
}

/// 解析授权并拼出保存路径：校验文件名 → 复核授权存在与归属 → 解析可信文档 → 拼路径。
/// 命令体在拿到 `(path, trusted_opt)` 后复用 `choose_save_target`/`save_document`/`build_saved_descriptor`。
fn resolve_save_target(
    store: &DocumentStore,
    document_id: Option<&str>,
    directory_id: &str,
    file_name: &str,
) -> Result<(PathBuf, Option<TrustedDocument>), DocumentCommandError> {
    validate_file_name(file_name)
        .map_err(|code| DocumentCommandError::new(code, "invalid file name"))?;
    let grant = state_grant_or_missing(store, directory_id)?;
    if !grant_matches_document(&grant, document_id) {
        return Err(DocumentCommandError::new(
            DocumentErrorCode::GrantMismatch,
            "save directory grant does not belong to the current document",
        ));
    }
    let trusted_opt = trusted_for_inline_save_as(store, document_id)?;
    let path = compose_save_path(&grant.path, file_name);
    Ok((path, trusted_opt))
}

/// 读取授权并在缺失时返回稳定错误。
fn state_grant_or_missing(
    store: &DocumentStore,
    grant_id: &str,
) -> Result<PendingSaveDirectory, DocumentCommandError> {
    store.current_save_grant(grant_id).ok_or_else(|| {
        DocumentCommandError::new(
            DocumentErrorCode::MissingGrant,
            "save directory grant is unknown or expired",
        )
    })
}

/// 内嵌另存为面板打开时取得默认目标草稿：文件名 + 可选默认目录授权。已有文档默认文件名
/// 为显示名、默认目录为其父目录（可用时发放授权）；Untitled 默认 `Untitled` 且无目录。
#[tauri::command]
pub fn prepare_save_as(
    document_id: Option<String>,
    state: tauri::State<'_, DocumentStore>,
) -> Result<SaveAsDraft, DocumentCommandError> {
    prepare_save_as_inner(state.inner(), document_id)
}

fn prepare_save_as_inner(
    store: &DocumentStore,
    document_id: Option<String>,
) -> Result<SaveAsDraft, DocumentCommandError> {
    let trusted_opt = trusted_for_inline_save_as(store, document_id.as_deref())?;
    let (file_name, directory_path) = build_save_as_draft(trusted_opt.as_ref());
    let directory = match directory_path {
        Some(dir) => {
            let display_name = directory_display_name(&dir);
            Some(store.establish_save_grant(document_id, dir, display_name)?)
        }
        None => {
            store.clear_save_grant();
            None
        }
    };
    Ok(SaveAsDraft {
        file_name,
        directory,
    })
}

/// 在 Rust 侧显示系统目录选择对话框并发放保存目录授权。前端不传入路径，取消返回 `None`
/// 且不改动既有授权。所选项经 canonicalize 与目录校验后绑定当前活动文档。
#[tauri::command]
pub async fn pick_save_directory(
    app: tauri::AppHandle,
    document_id: Option<String>,
    state: tauri::State<'_, DocumentStore>,
) -> Result<Option<SaveDirectoryGrant>, DocumentCommandError> {
    // 对话框打开前拒绝过期调用；返回后 `establish_save_grant` 在同一锁内再次复核，
    // 防止用户选择目录期间活动文档已经切换。
    trusted_for_inline_save_as(state.inner(), document_id.as_deref())?;
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let raw = folder.into_path().map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "selected directory is unavailable",
        )
    })?;
    let path = std::fs::canonicalize(&raw).map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "selected directory cannot be resolved",
        )
    })?;
    if !path.is_dir() {
        return Err(DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "selected path is not a directory",
        ));
    }
    let display_name = directory_display_name(&path);
    let grant = state.establish_save_grant(document_id, path, display_name)?;
    Ok(Some(grant))
}

/// 预览 `dir/file_name`：是否已存在、是否即当前活动文档原路径。不做写操作。授权不存在或
/// 不归属当前文档则报错；供前端写盘前决定是否提示"替换已有文件？"。
#[tauri::command]
pub fn preview_save_target(
    directory_id: String,
    file_name: String,
    document_id: Option<String>,
    state: tauri::State<'_, DocumentStore>,
) -> Result<TargetPreview, DocumentCommandError> {
    let grant = state_grant_or_missing(state.inner(), &directory_id)?;
    if !grant_matches_document(&grant, document_id.as_deref()) {
        return Err(DocumentCommandError::new(
            DocumentErrorCode::GrantMismatch,
            "save directory grant does not belong to the current document",
        ));
    }
    let trusted_opt = trusted_for_inline_save_as(state.inner(), document_id.as_deref())?;
    preview_target(&grant.path, &file_name, trusted_opt.as_ref())
        .map_err(|code| DocumentCommandError::new(code, "invalid save target"))
}

/// 内嵌另存为保存：文件名经 UTF-8 percent-encoding 后放入 [`FILE_NAME_HEADER`]，目录授权
/// id 经 [`DIRECTORY_ID_HEADER`]，格式与可选文档 id 经各自 header、内容经 Raw body 传入。
/// Rust 解析授权并拼路径，复用既有 `choose_save_target`/`save_document`/
/// `build_saved_descriptor`；成功后消费授权（单次使用）。
#[tauri::command]
pub async fn save_document_as_at(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, DocumentStore>,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    let headers = request.headers();
    let id_opt = headers
        .get(DOCUMENT_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let directory_id = headers
        .get(DIRECTORY_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
        .ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::MissingGrant,
                "save request is missing the directory id header",
            )
        })?;
    let file_name = headers
        .get(FILE_NAME_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(decode_file_name_header)
        .transpose()
        .map_err(|code| DocumentCommandError::new(code, "save file name header is invalid"))?
        .ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::InvalidFileName,
                "save request is missing the file name header",
            )
        })?;
    let encoding = parse_encoding_header(headers)?;
    let line_ending = parse_line_ending_header(headers)?;
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

    save_document_as_at_inner(
        state.inner(),
        id_opt.as_deref(),
        &directory_id,
        &file_name,
        encoding,
        line_ending,
        content,
    )
    .await
}

async fn save_document_as_at_inner(
    store: &DocumentStore,
    document_id: Option<&str>,
    directory_id: &str,
    file_name: &str,
    encoding: TextEncoding,
    line_ending: LineEnding,
    content: String,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    let (path, trusted_opt) = resolve_save_target(store, document_id, directory_id, file_name)?;
    let path_for_assoc = path.clone();
    let encoding_for_assoc = encoding;
    let line_ending_for_assoc = line_ending;
    let snapshot = content.clone();
    let (in_place, core_result) = tauri::async_runtime::spawn_blocking(move || {
        let target = choose_save_target(&path, trusted_opt.as_ref())
            .map_err(DocumentCommandError::from_save_core)?;
        let in_place = matches!(target, crate::document::SaveTarget::InPlace { .. });
        let result = document::save_document(
            &path,
            document::SaveRequest {
                content,
                encoding,
                line_ending,
                target,
            },
        );
        Ok::<_, DocumentCommandError>((in_place, result))
    })
    .await
    .map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::SaveFailed,
            "save worker could not complete",
        )
    })??;

    let outcome = match core_result {
        Ok(outcome) => outcome,
        Err(DocumentError::SaveConflict) if in_place => {
            let kind =
                classify_conflict(&path_for_assoc).map_err(DocumentCommandError::from_save_core)?;
            if let Some(id) = document_id {
                store.record_conflict(id, kind, snapshot.into_bytes());
            }
            return Err(DocumentCommandError::new(
                conflict_error_code(kind),
                "save conflict detected",
            ));
        }
        Err(other) => return Err(DocumentCommandError::from_save_core(other)),
    };

    let descriptor = build_saved_descriptor(
        store,
        document_id,
        &path_for_assoc,
        encoding_for_assoc,
        line_ending_for_assoc,
        outcome,
    )?;
    store.take_save_grant(directory_id);
    Ok(descriptor)
}

/// 成功保存后建立描述符并更新可信状态：首次保存生成新 id；另存到新目标沿用 id 关联；
/// 选当前原路径按普通保存只更新指纹/字节数。
fn build_saved_descriptor(
    state: &DocumentStore,
    id_opt: Option<&str>,
    path: &std::path::Path,
    encoding: TextEncoding,
    line_ending: LineEnding,
    outcome: crate::document::SaveOutcome,
) -> Result<DocumentDescriptor, DocumentCommandError> {
    let resolved = std::fs::canonicalize(path)
        .map_err(|err| DocumentCommandError::from_save_core(DocumentError::Io(err)))?;
    let display_name = display_name_of(path);
    let read_only = std::fs::metadata(&resolved)
        .map_err(|err| DocumentCommandError::from_save_core(DocumentError::Io(err)))?
        .permissions()
        .readonly();

    if let Some(id) = id_opt {
        // 已有文档：若仍是原路径则按普通保存更新指纹，否则关联到新目标。
        let trusted = state.active_for(id).ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::UnknownDocument,
                "unknown or stale document id",
            )
        })?;
        let in_place = std::fs::canonicalize(&trusted.path)
            .map(|tr| tr == resolved)
            .unwrap_or(false);
        if in_place {
            state.update_active(id, outcome.fingerprint.clone(), outcome.byte_count);
            return Ok(trusted.to_descriptor(id, outcome.fingerprint, outcome.byte_count));
        }
        let reassociated = TrustedDocument {
            // 保留用户在系统对话框中选择的路径；冲突判断仍用上面的规范化路径。
            // 这样通过符号链接另存后，后续普通保存继续保持链接语义。
            path: path.to_path_buf(),
            display_name,
            encoding,
            line_ending,
            fingerprint: outcome.fingerprint.clone(),
            byte_count: outcome.byte_count,
            read_only,
        };
        state.reassociate_active(id, reassociated.clone());
        Ok(reassociated.to_descriptor(id, outcome.fingerprint, outcome.byte_count))
    } else {
        // 首次保存：生成新 id 并建立关联。
        let created = TrustedDocument {
            path: path.to_path_buf(),
            display_name,
            encoding,
            line_ending,
            fingerprint: outcome.fingerprint.clone(),
            byte_count: outcome.byte_count,
            read_only,
        };
        let new_id = state.create_active(created.clone());
        Ok(created.to_descriptor(&new_id, outcome.fingerprint, outcome.byte_count))
    }
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

    #[cfg(unix)]
    #[test]
    fn saved_descriptor_preserves_the_user_selected_symlink_path() {
        use crate::document::test_support::TestDir;
        use std::os::unix::fs::symlink;

        let dir = TestDir::new();
        let target = dir.join("target.txt");
        std::fs::write(&target, b"saved").unwrap();
        let link = dir.join("selected-link.txt");
        symlink(&target, &link).unwrap();
        let fingerprint = FileFingerprint::of(b"saved");
        let store = DocumentStore::default();

        let descriptor = build_saved_descriptor(
            &store,
            None,
            &link,
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
            crate::document::SaveOutcome {
                byte_count: 5,
                fingerprint: fingerprint.clone(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
            },
        )
        .unwrap();

        assert_eq!(descriptor.path, link);
        assert_eq!(
            store.active_for(&descriptor.id).unwrap().path,
            descriptor.path
        );
        assert_eq!(std::fs::read(&descriptor.path).unwrap(), b"saved");
    }

    fn test_trusted(path: &str) -> TrustedDocument {
        TrustedDocument {
            path: PathBuf::from(path),
            display_name: "test.txt".to_owned(),
            encoding: TextEncoding::Utf8 { bom: false },
            line_ending: LineEnding::Lf,
            fingerprint: FileFingerprint {
                size_bytes: 3,
                sha256: "abc".to_owned(),
            },
            byte_count: 3,
            read_only: false,
        }
    }

    #[test]
    fn inline_save_draft_uses_trusted_parent_and_untitled_has_no_directory() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let path = dir.join("notes.md");
        let trusted = TrustedDocument {
            path,
            display_name: "notes.md".to_owned(),
            ..test_trusted("/tmp/unused.txt")
        };

        assert_eq!(
            build_save_as_draft(Some(&trusted)),
            ("notes.md".to_owned(), Some(dir.path().to_path_buf()))
        );
        assert_eq!(build_save_as_draft(None), ("Untitled".to_owned(), None));
    }

    #[test]
    fn prepare_inline_save_issues_default_grant_and_untitled_resets_old_grant() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let path = dir.join("notes.md");
        std::fs::write(&path, b"notes").unwrap();
        let trusted = TrustedDocument {
            path,
            display_name: "notes.md".to_owned(),
            fingerprint: FileFingerprint::of(b"notes"),
            byte_count: 5,
            ..test_trusted("/tmp/unused.txt")
        };
        let store = DocumentStore::default();
        let id = store.create_active(trusted);

        let draft = prepare_save_as_inner(&store, Some(id.clone())).unwrap();
        let directory = draft.directory.unwrap();
        assert_eq!(draft.file_name, "notes.md");
        assert_eq!(directory.display_name, directory_display_name(dir.path()));
        assert!(store.current_save_grant(&directory.id).is_some());

        assert!(store.close_active(&id));
        let stale_untitled_grant = store
            .establish_save_grant(None, dir.path().to_path_buf(), "stale".to_owned())
            .unwrap();
        let untitled = prepare_save_as_inner(&store, None).unwrap();
        assert_eq!(untitled.file_name, "Untitled");
        assert!(untitled.directory.is_none());
        assert!(store.current_save_grant(&stale_untitled_grant.id).is_none());
    }

    #[test]
    fn inline_save_file_name_validation_rejects_path_injection() {
        assert!(validate_file_name("报告 2026.txt").is_ok());
        assert!(validate_file_name(".notes").is_ok());
        for invalid in [
            "",
            ".",
            "..",
            "nested/name.txt",
            "nested\\name.txt",
            "nul\0name",
        ] {
            assert_eq!(
                validate_file_name(invalid),
                Err(DocumentErrorCode::InvalidFileName)
            );
        }

        let base = std::path::Path::new("/trusted/directory");
        assert_eq!(
            compose_save_path(base, "报告 2026.txt"),
            base.join("报告 2026.txt")
        );

        assert_eq!(
            decode_file_name_header("%E6%8A%A5%E5%91%8A%202026%25.txt").unwrap(),
            "报告 2026%.txt"
        );
        assert_eq!(
            decode_file_name_header("bad%2").unwrap_err(),
            DocumentErrorCode::InvalidFileName
        );
        assert_eq!(
            decode_file_name_header("%2Fescape.txt").unwrap(),
            "/escape.txt"
        );
        assert_eq!(
            validate_file_name(&decode_file_name_header("%2Fescape.txt").unwrap()),
            Err(DocumentErrorCode::InvalidFileName)
        );
    }

    #[test]
    fn save_directory_grant_is_bound_replaced_and_cleared_with_document_context() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/active.txt"));
        let first = store
            .establish_save_grant(
                Some(id.clone()),
                dir.path().to_path_buf(),
                "first".to_owned(),
            )
            .unwrap();
        let stored = store.current_save_grant(&first.id).unwrap();
        assert!(grant_matches_document(&stored, Some(&id)));
        assert!(!grant_matches_document(&stored, None));

        let second = store
            .establish_save_grant(
                Some(id.clone()),
                dir.path().to_path_buf(),
                "second".to_owned(),
            )
            .unwrap();
        assert_ne!(first.id, second.id);
        assert!(store.current_save_grant(&first.id).is_none());
        assert!(store.current_save_grant(&second.id).is_some());

        let stale = store.establish_save_grant(
            Some("stale".to_owned()),
            dir.path().to_path_buf(),
            "stale".to_owned(),
        );
        assert_eq!(stale.unwrap_err().code, DocumentErrorCode::UnknownDocument);
        assert!(store.current_save_grant(&second.id).is_some());

        assert!(store.close_active(&id));
        assert!(store.current_save_grant(&second.id).is_none());
    }

    #[test]
    fn candidate_open_invalidates_save_directory_grant_before_document_switch() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/active.txt"));
        let grant = store
            .establish_save_grant(Some(id), dir.path().to_path_buf(), "target".to_owned())
            .unwrap();

        store.store_open(
            "candidate".to_owned(),
            b"candidate".to_vec(),
            test_trusted("/tmp/candidate.txt"),
        );
        assert!(store.current_save_grant(&grant.id).is_none());
    }

    #[test]
    fn preview_reports_existing_and_current_targets_without_writing() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let current = dir.join("current.txt");
        let other = dir.join("other.txt");
        std::fs::write(&current, b"current").unwrap();
        std::fs::write(&other, b"other").unwrap();
        let trusted = TrustedDocument {
            path: current,
            display_name: "current.txt".to_owned(),
            fingerprint: FileFingerprint::of(b"current"),
            byte_count: 7,
            ..test_trusted("/tmp/unused.txt")
        };

        assert_eq!(
            preview_target(dir.path(), "current.txt", Some(&trusted)).unwrap(),
            TargetPreview {
                exists: true,
                is_current_path: true,
            }
        );
        assert_eq!(
            preview_target(dir.path(), "other.txt", Some(&trusted)).unwrap(),
            TargetPreview {
                exists: true,
                is_current_path: false,
            }
        );
        assert_eq!(
            preview_target(dir.path(), "missing.txt", Some(&trusted)).unwrap(),
            TargetPreview {
                exists: false,
                is_current_path: false,
            }
        );
        assert_eq!(
            preview_target(dir.path(), "../escape.txt", Some(&trusted)),
            Err(DocumentErrorCode::InvalidFileName)
        );
    }

    #[test]
    fn inline_first_save_consumes_grant_only_after_success() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let grant = store
            .establish_save_grant(None, dir.path().to_path_buf(), "target".to_owned())
            .unwrap();
        let descriptor = tauri::async_runtime::block_on(save_document_as_at_inner(
            &store,
            None,
            &grant.id,
            "saved.txt",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
            "saved content".to_owned(),
        ))
        .unwrap();

        assert_eq!(
            std::fs::read(dir.join("saved.txt")).unwrap(),
            b"saved content"
        );
        assert_eq!(descriptor.display_name, "saved.txt");
        assert!(store.current_save_grant(&grant.id).is_none());
        assert!(store.active_for(&descriptor.id).is_some());
    }

    #[test]
    fn inline_save_failure_keeps_grant_for_retry() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let grant = store
            .establish_save_grant(None, dir.path().to_path_buf(), "target".to_owned())
            .unwrap();
        let error = tauri::async_runtime::block_on(save_document_as_at_inner(
            &store,
            None,
            &grant.id,
            "saved.txt",
            TextEncoding::Gbk,
            LineEnding::Lf,
            "emoji 😀".to_owned(),
        ))
        .unwrap_err();

        assert_eq!(error.code, DocumentErrorCode::UnencodableContent);
        assert!(store.current_save_grant(&grant.id).is_some());
        assert!(!dir.join("saved.txt").exists());
    }

    #[test]
    fn inline_save_rejects_missing_and_cross_document_grants() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let missing = resolve_save_target(&store, None, "missing", "file.txt").unwrap_err();
        assert_eq!(missing.code, DocumentErrorCode::MissingGrant);

        let id = store.create_active(test_trusted("/tmp/active.txt"));
        let grant = store
            .establish_save_grant(Some(id), dir.path().to_path_buf(), "target".to_owned())
            .unwrap();
        let mismatch = resolve_save_target(&store, None, &grant.id, "file.txt").unwrap_err();
        assert_eq!(mismatch.code, DocumentErrorCode::GrantMismatch);
        assert!(store.current_save_grant(&grant.id).is_some());
    }

    #[test]
    fn inline_save_to_current_path_preserves_in_place_conflict_protection() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let path = dir.join("current.txt");
        std::fs::write(&path, b"original").unwrap();
        let trusted = TrustedDocument {
            path: path.clone(),
            display_name: "current.txt".to_owned(),
            fingerprint: FileFingerprint::of(b"original"),
            byte_count: 8,
            ..test_trusted("/tmp/unused.txt")
        };
        let store = DocumentStore::default();
        let id = store.create_active(trusted);
        let grant = store
            .establish_save_grant(
                Some(id.clone()),
                dir.path().to_path_buf(),
                "target".to_owned(),
            )
            .unwrap();
        std::fs::write(&path, b"external change").unwrap();

        let error = tauri::async_runtime::block_on(save_document_as_at_inner(
            &store,
            Some(&id),
            &grant.id,
            "current.txt",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
            "my edits".to_owned(),
        ))
        .unwrap_err();

        assert_eq!(error.code, DocumentErrorCode::SaveConflictContentChanged);
        assert_eq!(std::fs::read(&path).unwrap(), b"external change");
        assert!(store.current_save_grant(&grant.id).is_some());
        assert_eq!(store.conflict_for(&id).unwrap().snapshot, b"my edits");
    }

    #[test]
    fn inline_save_to_missing_current_path_routes_target_missing() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let path = dir.join("current.txt");
        std::fs::write(&path, b"original").unwrap();
        let trusted = TrustedDocument {
            path: path.clone(),
            display_name: "current.txt".to_owned(),
            fingerprint: FileFingerprint::of(b"original"),
            byte_count: 8,
            ..test_trusted("/tmp/unused.txt")
        };
        let store = DocumentStore::default();
        let id = store.create_active(trusted);
        let grant = store
            .establish_save_grant(
                Some(id.clone()),
                dir.path().to_path_buf(),
                "target".to_owned(),
            )
            .unwrap();
        std::fs::remove_file(&path).unwrap();

        let error = tauri::async_runtime::block_on(save_document_as_at_inner(
            &store,
            Some(&id),
            &grant.id,
            "current.txt",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
            "my edits".to_owned(),
        ))
        .unwrap_err();

        assert_eq!(error.code, DocumentErrorCode::SaveConflictTargetMissing);
        assert!(!path.exists());
        assert!(store.current_save_grant(&grant.id).is_some());
        assert_eq!(store.conflict_for(&id).unwrap().snapshot, b"my edits");
    }

    #[test]
    fn classify_conflict_distinguishes_existing_vs_missing() {
        use crate::document::test_support::TestDir;
        let dir = TestDir::new();
        let existing = dir.join("exists.txt");
        std::fs::write(&existing, b"data").unwrap();
        let missing = dir.join("missing.txt");
        assert_eq!(
            classify_conflict(&existing).unwrap(),
            ConflictKind::ContentChanged
        );
        assert_eq!(
            classify_conflict(&missing).unwrap(),
            ConflictKind::TargetMissing
        );
    }

    #[test]
    fn classify_conflict_preserves_non_not_found_io_errors() {
        let invalid = std::path::Path::new("\0");
        assert!(matches!(
            classify_conflict(invalid),
            Err(DocumentError::Io(_))
        ));
    }

    #[test]
    fn target_exists_distinguishes_missing_from_other_io_errors() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let existing = dir.join("exists.txt");
        std::fs::write(&existing, b"data").unwrap();
        assert_eq!(target_exists(&existing).unwrap(), true);
        assert_eq!(target_exists(&dir.join("missing.txt")).unwrap(), false);
        assert!(matches!(
            target_exists(std::path::Path::new("\0")),
            Err(DocumentError::Io(_))
        ));
    }

    #[test]
    fn close_active_clears_matching_state_and_rejects_stale_id() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/close.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"edits".to_vec());

        assert!(!store.close_active("stale"));
        assert!(store.active_for(&id).is_some());
        assert!(store.close_active(&id));
        assert!(store.active_for(&id).is_none());
        assert!(store.conflict_for(&id).is_none());
        assert!(!store.close_active(&id));
    }

    #[test]
    fn record_conflict_and_query_by_matching_id() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        assert_eq!(
            store.conflict_for(&id).map(|conflict| conflict.kind),
            Some(ConflictKind::ContentChanged)
        );
    }

    #[test]
    fn conflict_kind_for_stale_id_returns_none() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::TargetMissing, b"snap".to_vec());
        // 过期 id（不匹配活动文档）不得返回冲突状态。
        assert!(store.conflict_for("stale-doc").is_none());
    }

    #[test]
    fn reading_conflict_does_not_consume_it_before_resolution_succeeds() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        let first = store.conflict_for(&id).unwrap();
        let retry = store.conflict_for(&id).unwrap();
        assert_eq!(first.kind, ConflictKind::ContentChanged);
        assert_eq!(first.snapshot, b"snap");
        assert_eq!(retry.snapshot, first.snapshot);
        assert_eq!(retry.trusted.path, first.trusted.path);
    }

    #[test]
    fn candidate_open_keeps_conflict_until_content_is_committed() {
        let store = DocumentStore::default();
        let active_id = store.create_active(test_trusted("/tmp/active.txt"));
        store.record_conflict(&active_id, ConflictKind::ContentChanged, b"snap".to_vec());

        let candidate_id = "candidate".to_owned();
        store.store_open(
            candidate_id.clone(),
            b"new content".to_vec(),
            test_trusted("/tmp/candidate.txt"),
        );
        assert!(store.conflict_for(&active_id).is_some());

        assert_eq!(
            store.take_content(&candidate_id),
            Some(b"new content".to_vec())
        );
        assert!(store.conflict_for(&active_id).is_none());
    }

    #[test]
    fn create_active_clears_existing_conflict() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        let _new = store.create_active(test_trusted("/tmp/y.txt"));
        // 会话变更（新文档打开/首次保存）清除旧冲突状态。
        assert!(store.conflict_for(&id).is_none());
    }

    #[test]
    fn update_active_clears_conflict_on_successful_save() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        store.update_active(
            &id,
            FileFingerprint {
                size_bytes: 4,
                sha256: "new".to_owned(),
            },
            4,
        );
        // 普通保存成功后冲突状态被清除。
        assert!(store.conflict_for(&id).is_none());
    }

    #[test]
    fn conflict_error_code_maps_each_kind() {
        assert_eq!(
            conflict_error_code(ConflictKind::ContentChanged),
            DocumentErrorCode::SaveConflictContentChanged
        );
        assert_eq!(
            conflict_error_code(ConflictKind::TargetMissing),
            DocumentErrorCode::SaveConflictTargetMissing
        );
    }

    #[test]
    fn clear_conflict_resolves_pending_state() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        assert!(store.conflict_for(&id).is_some());
        assert!(store.clear_content_conflict(&id));
        // 取消后冲突状态已清除。
        assert!(store.conflict_for(&id).is_none());
        assert!(!store.clear_content_conflict(&id));
    }

    #[test]
    fn clear_conflict_on_stale_id_is_noop() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        // 过期 id 的取消不清除不属于该 id 的冲突。
        assert!(!store.clear_content_conflict("stale-doc"));
        assert!(store.conflict_for(&id).is_some());
    }

    #[test]
    fn prepare_reload_then_take_content_promotes_and_clears_conflict() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"old snap".to_vec());
        let revision = store.conflict_for(&id).unwrap().revision;

        // 重新加载成功：缓冲新内容为候选。
        let updated = test_trusted("/tmp/x.txt");
        assert!(store.prepare_reload(&id, revision, b"reloaded content".to_vec(), updated));

        // 取回内容时原子提升活动文档并清除冲突。
        let content = store.take_content(&id);
        assert_eq!(content, Some(b"reloaded content".to_vec()));
        assert!(store.conflict_for(&id).is_none());
    }

    #[test]
    fn content_conflict_for_returns_only_content_changed_state() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/specific.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        assert_eq!(
            store
                .content_conflict_for(&id)
                .map(|conflict| conflict.trusted.path),
            Some(PathBuf::from("/tmp/specific.txt"))
        );
        // 过期 id 不返回路径。
        assert!(store.content_conflict_for("stale").is_none());

        store.record_conflict(&id, ConflictKind::TargetMissing, b"snap".to_vec());
        assert!(store.content_conflict_for(&id).is_none());
        assert!(!store.clear_content_conflict(&id));
    }

    #[test]
    fn overwrite_lease_blocks_other_resolutions_and_failure_releases_for_retry() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/overwrite.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"my edits".to_vec());

        let conflict = store.begin_overwrite(&id).unwrap();
        assert_eq!(conflict.snapshot, b"my edits");
        assert!(store.begin_overwrite(&id).is_none());
        assert!(!store.clear_content_conflict(&id));
        assert!(!store.prepare_reload(
            &id,
            conflict.revision,
            b"disk".to_vec(),
            test_trusted("/tmp/overwrite.txt")
        ));

        assert!(store.abort_overwrite(&id, conflict.revision));
        assert!(store.conflict_for(&id).is_some());
        let retry = store.begin_overwrite(&id).unwrap();
        assert_eq!(retry.revision, conflict.revision);
        assert!(store.abort_overwrite(&id, retry.revision));
        assert!(store.clear_content_conflict(&id));
    }

    #[test]
    fn overwrite_commit_atomically_checks_revision_and_updates_active() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/overwrite.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"my edits".to_vec());
        let conflict = store.begin_overwrite(&id).unwrap();
        let fingerprint = FileFingerprint::of(b"my edits");

        let updated = store
            .commit_overwrite(&id, conflict.revision, fingerprint.clone(), 8)
            .unwrap();
        assert_eq!(updated.fingerprint, fingerprint);
        assert_eq!(updated.byte_count, 8);
        assert!(store.conflict_for(&id).is_none());
        assert_eq!(store.active_for(&id).unwrap().fingerprint, fingerprint);
        assert!(
            store
                .commit_overwrite(&id, conflict.revision, FileFingerprint::of(b"x"), 1)
                .is_none()
        );
    }

    #[test]
    fn stale_overwrite_commit_cannot_clear_a_newer_conflict() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/overwrite.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"first".to_vec());
        let first = store.begin_overwrite(&id).unwrap();
        assert!(store.abort_overwrite(&id, first.revision));

        store.record_conflict(&id, ConflictKind::ContentChanged, b"second".to_vec());
        let second = store.conflict_for(&id).unwrap();
        assert_ne!(second.revision, first.revision);
        assert!(
            store
                .commit_overwrite(&id, first.revision, FileFingerprint::of(b"first"), 5)
                .is_none()
        );
        assert_eq!(store.conflict_for(&id).unwrap().snapshot, b"second");
    }

    #[test]
    fn force_overwrite_writes_the_conflict_snapshot_and_commits_trusted_state() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let path = dir.join("overwrite.txt");
        std::fs::write(&path, b"external version").unwrap();
        let mut trusted = test_trusted(path.to_str().unwrap());
        trusted.fingerprint = FileFingerprint::of(b"original");
        trusted.byte_count = 8;
        let store = DocumentStore::default();
        let id = store.create_active(trusted);
        store.record_conflict(
            &id,
            ConflictKind::ContentChanged,
            b"my complete edits".to_vec(),
        );

        let descriptor =
            tauri::async_runtime::block_on(force_overwrite_inner(id.clone(), &store)).unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"my complete edits");
        assert_eq!(
            descriptor.fingerprint,
            FileFingerprint::of(b"my complete edits")
        );
        assert_eq!(descriptor.byte_count, 17);
        assert!(store.conflict_for(&id).is_none());
        assert_eq!(
            store.active_for(&id).unwrap().fingerprint,
            descriptor.fingerprint
        );
    }

    #[test]
    fn force_overwrite_failure_keeps_conflict_and_releases_lease() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let path = dir.join("missing.txt");
        let mut trusted = test_trusted(path.to_str().unwrap());
        trusted.fingerprint = FileFingerprint::of(b"original");
        let store = DocumentStore::default();
        let id = store.create_active(trusted);
        store.record_conflict(&id, ConflictKind::ContentChanged, b"my edits".to_vec());

        let error =
            tauri::async_runtime::block_on(force_overwrite_inner(id.clone(), &store)).unwrap_err();
        assert_eq!(error.code, DocumentErrorCode::SaveFailed);
        assert_eq!(store.conflict_for(&id).unwrap().snapshot, b"my edits");
        let retry = store.begin_overwrite(&id).unwrap();
        assert!(store.abort_overwrite(&id, retry.revision));
    }

    #[test]
    fn stale_reload_revision_cannot_publish_a_candidate() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"first".to_vec());
        let stale_revision = store.conflict_for(&id).unwrap().revision;
        store.record_conflict(&id, ConflictKind::ContentChanged, b"second".to_vec());

        assert!(!store.prepare_reload(
            &id,
            stale_revision,
            b"stale reload".to_vec(),
            test_trusted("/tmp/x.txt")
        ));
        assert!(store.take_content(&id).is_none());
        assert_eq!(store.conflict_for(&id).unwrap().snapshot, b"second");
    }

    #[test]
    fn cancel_after_prepare_prevents_candidate_commit() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        let revision = store.conflict_for(&id).unwrap().revision;
        assert!(store.prepare_reload(
            &id,
            revision,
            b"reload".to_vec(),
            test_trusted("/tmp/x.txt")
        ));

        assert!(store.clear_content_conflict(&id));
        assert!(store.take_content(&id).is_none());
    }
}
