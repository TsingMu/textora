//! 文档核心的受限 Tauri 命令层。
//!
//! 这些命令把内部 [`document`] 能力以最小方式暴露给前端：元数据走小型 JSON 响应，
//! Unicode 内容走原始二进制——打开经 `ipc::Response` 返回、保存经 `ipc::Request` 的
//! Raw body 与自定义 header 接收，避免把大文本编码为 JSON 数字数组或大字符串。错误
//! 以稳定代码返回，前端据此映射用户可理解的提示，不展示 Rust 内部调试文本。

use std::collections::HashMap;
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::document::{
    self, DocumentDescriptor, DocumentError, FileFingerprint, LineEnding, TextEncoding,
};
use crate::session_restore::{
    ManifestLoadOutcome, ManifestProjectionError, ManifestUpdateOutcome, RestoreManifest,
    SessionManifestStore,
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
    // 启动恢复清单
    /// 应用数据目录中的打开文件清单无法写入（I/O 失败或存储不可用）。
    SessionManifestWriteFailed,
}

/// 跨 IPC 的文档命令错误。`character` 与 `byteOffset` 仅在不可编码字符时填充，供
/// 上层展示；其余字段为 `None`。`message` 仅供诊断，不向用户呈现。
#[derive(Debug, Clone, PartialEq, Serialize)]
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

    pub(crate) fn from_open_core(err: DocumentError) -> Self {
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

/// 对关联文档复核磁盘目标后的外部变化分类。只有内容或只读元数据变化会建立可原子提升的重载候选；
/// 无变化、缺失与重读失败都不修改活动可信状态。
#[derive(Debug)]
#[allow(dead_code)]
pub(crate) enum ExternalChange {
    /// 字节指纹与只读状态均与可信基线一致：无变化。
    Unchanged,
    /// 字节指纹变化（含解码后文本相同但字节不同）；已建立重载候选，待原子提升。
    ContentChanged,
    /// 字节指纹相同但只读状态变化；已建立只更新元数据的候选，不替换文本。
    MetadataChanged,
    /// 路径目标缺失（删除/移动/符号链接目标消失）。
    Missing,
    /// 无法安全重读：读取期间再次变化、超限、无效编码、权限或一般 I/O 错误。携带原始错误，
    /// 便于后续切片映射到稳定的、不泄露内部路径/指纹的前端错误代码。
    ReloadFailed(DocumentError),
}

/// 已建立的外部重载候选。绑定复核时的可信基线指纹/路径，提升时用于过期校验：
/// 若活动可信状态已变（用户保存/另存为/关闭），候选作废，绝不替换新状态。
#[derive(Debug, Clone)]
struct ExternalReloadCandidate {
    generation: u64,
    baseline_fingerprint: FileFingerprint,
    baseline_path: PathBuf,
    /// 复核得到的新可信元数据（内容变化或只读变化后）。
    trusted: TrustedDocument,
    /// 新内容（UTF-8 字节）；`None` 表示仅只读变化，提升时只更新元数据，不替换文本。
    content: Option<Vec<u8>>,
}

/// 原子提升外部重载候选后的结果。
#[cfg(test)]
#[derive(Debug, PartialEq)]
enum ExternalReload {
    /// 内容变化：新描述符与新内容；活动可信元数据已推进到候选。
    Content {
        descriptor: DocumentDescriptor,
        content: String,
    },
    /// 仅只读元数据变化：更新后的描述符；内容不变。
    Metadata { descriptor: DocumentDescriptor },
}

/// 前端采用外部变化候选后的轻量结果。内容变化的正文继续复用二进制
/// `read_document_content` 通道，不进入 JSON。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalReloadReady {
    Content { descriptor: DocumentDescriptor },
    Metadata { descriptor: DocumentDescriptor },
}

/// 用户从实时重载失败提示点击 Retry 后的复核结果。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExternalReloadRetry {
    Ready { reload: ExternalReloadReady },
    Missing,
    Failed { error: DocumentCommandError },
    Unchanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalDocumentChangeKind {
    Content,
    Metadata,
    Missing,
    ReloadFailed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDocumentChanged {
    pub document_id: String,
    pub kind: ExternalDocumentChangeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<DocumentCommandError>,
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

/// 前端当前已打开的文件标签。路径只用于与系统选择器/授权目录生成的可信路径做同一性比较；
/// 后端仍不接受它作为读取或写入目标。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownDocumentPath {
    pub tab_id: String,
    pub path: PathBuf,
}

/// 打开文件选择结果：新文件返回候选描述符；已打开的同一路径返回已有标签 id，不重复读取。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpenDocumentSelection {
    Opened { descriptor: DocumentDescriptor },
    Existing { tab_id: String },
}

/// 一次启动恢复推进的结果。恢复命令逐项打开清单文件：任意时刻后端至多一个已打开
/// 条目滞留在候选缓冲中，前端经 `read_document_content` 取回（或下一次推进清除未取回
/// 缓冲）后才继续，恢复内存因此有界于单个文件。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionRestoreStep {
    /// 恢复开始：清单项总数与清单声明的活动索引（活动项是否成立由前端在采用时判定）。
    Started {
        total: usize,
        active_index: Option<usize>,
    },
    /// 一个文件已按既有打开保护读入候选缓冲；只含描述符与清单索引，不含失败摘要。
    Item {
        descriptor: DocumentDescriptor,
        manifest_index: usize,
    },
    /// 该清单条目的路径身份与当前已打开文档一致（如中断期间经普通 Open/Save As 打开）：
    /// 不重复读取或建立第二个后端文档；前端把清单索引映射到该文档的现有标签。
    AlreadyOpen {
        document_id: String,
        manifest_index: usize,
    },
    /// 一个文件打开失败（缺失、无权限、超限、编码或读取竞争）；继续推进其余项。
    Failed {
        display_name: String,
        error: DocumentCommandError,
    },
    /// 清单缺失/损坏或全部项已处理完毕。
    Done,
}

/// 启动恢复的逐项游标（Tauri managed state）。整个恢复每个进程至多开始一次；持有
/// 清单、下一清单索引、去重用已接受路径与当前滞留缓冲的文档 id。命令由前端串行
/// 驱动，锁内推进保证无论前端行为如何，后端同时至多缓冲一个已打开文件。
#[derive(Default)]
pub struct SessionRestoreCursor {
    inner: Mutex<SessionRestoreCursorInner>,
}

#[derive(Default)]
struct SessionRestoreCursorInner {
    started: bool,
    finished: bool,
    manifest: Option<RestoreManifest>,
    next_index: usize,
    accepted_paths: Vec<PathBuf>,
    buffered_document_id: Option<String>,
}

/// 前端提交的打开文件清单投影：有序可信文档 ID 与可选活动文档 ID。路径只能由 Rust
/// 从可信状态投影产生；generation 为前端进程内单调递增编号，用于拒绝迟到的旧集合。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionManifestProjection {
    pub generation: u64,
    pub document_ids: Vec<String>,
    pub active_document_id: Option<String>,
}

/// 清单投影更新的结果：成功写入、因 generation 过期被忽略，或因投影含过期/未知文档 id
/// 被拒绝（等待更新的投影，不视为需要提示的失败）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionManifestUpdateStatus {
    Written,
    Stale,
    Rejected,
}

/// 目标预览：`dir/file_name` 是否已存在、是否即当前活动文档原路径。用于"替换确认"。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetPreview {
    pub exists: bool,
    pub is_current_path: bool,
    pub occupied_tab_id: Option<String>,
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

/// 单个文档的可信状态：候选打开/重载缓冲、已提升的活动可信元数据、待解决冲突、
/// 覆盖租约与保存目录授权。多标签会话下同一 `DocumentStore` 并发持有多个 entry，
/// 按文档 id 索引；单文档使用时退化为唯一 entry。
#[derive(Default)]
struct DocumentEntry {
    /// 候选打开/重载时暂存的解码后内容，供 `read_document_content` 按 id 取回一次。
    pending_content: Option<Vec<u8>>,
    /// 与 `pending_content` 同属一次候选；内容成功取回前不得提升为 `active`。
    pending_trusted: Option<TrustedDocument>,
    /// 重新加载候选绑定的冲突版本；普通打开候选为 `None`。
    pending_reload_revision: Option<u64>,
    /// 内容成功取回后提升的可信元数据，供保存按 id 解析。
    active: Option<TrustedDocument>,
    /// 该文档的待解决内容冲突。
    conflict: Option<ConflictState>,
    /// 正在执行的强制覆盖租约，绑定该文档的冲突版本。租约存在期间该文档的其他冲突
    /// 解决操作必须拒绝；其他文档的 entry 不受影响。
    pending_overwrite: Option<u64>,
    /// 该文档授权的内嵌另存为保存目录。文档关闭/成功落盘后清除。
    pending_save_directory: Option<PendingSaveDirectory>,
    /// 当前单文档前端打开入口的过渡标记：候选内容被成功取回时替换整个后端会话，
    /// 避免旧单文档 session 的 active/conflict/grant 留成不可达状态。
    pending_replaces_session: bool,
    /// 外部文件变化复核建立的重载候选。不替换活动状态；`take_external_reload` 在基线
    /// 仍匹配时原子提升。基线已变（保存/另存为/关闭）时作废，避免过期结果污染新会话。
    pending_external_reload: Option<ExternalReloadCandidate>,
    /// 每次开始外部复核或活动文档状态发生变化时推进。较早开始、较晚完成的复核只有在
    /// 世代仍匹配时才能发布候选，防止旧磁盘观察覆盖更新的结果。
    external_check_generation: u64,
}

impl DocumentEntry {
    fn invalidate_external_reload(&mut self) {
        self.external_check_generation = self.external_check_generation.wrapping_add(1);
        self.pending_external_reload = None;
    }
}

#[derive(Debug, Clone)]
struct ExternalCheck {
    generation: u64,
    baseline: TrustedDocument,
}

/// 多标签会话下的后端文档状态：按文档 id 并发持有多个 `DocumentEntry`。冲突版本与
/// 授权 id 计数为全局单调，保证跨文档唯一。
#[derive(Default)]
struct DocumentStoreInner {
    documents: HashMap<String, DocumentEntry>,
    /// Untitled 首次保存授权（无后端文档，因此无 entry 可挂）。多标签下与各文件标签的
    /// 授权共存；前端切片接管 Untitled 身份后可下沉到 entry。
    untitled_save_directory: Option<PendingSaveDirectory>,
    /// 单调递增的内部冲突版本，跨文档唯一，只在 Rust 可信状态中使用，不暴露给前端。
    next_conflict_revision: u64,
    /// 单调递增的目录授权 id 计数器，跨文档唯一，只在内嵌另存为契约内部使用。
    next_save_directory_id: u64,
}

/// 后端文档状态：按 id 并发维护多个文档的候选打开内容缓冲与可信保存元数据。
#[derive(Default)]
pub struct DocumentStore {
    inner: Mutex<DocumentStoreInner>,
}

impl DocumentStore {
    #[allow(dead_code)]
    fn store_open(&self, id: String, content: Vec<u8>, document: TrustedDocument) {
        self.store_open_inner(id, content, document, false);
    }

    #[allow(dead_code)]
    fn store_open_replacing_session(
        &self,
        id: String,
        content: Vec<u8>,
        document: TrustedDocument,
    ) {
        self.store_open_inner(id, content, document, true);
    }

    fn store_open_inner(
        &self,
        id: String,
        content: Vec<u8>,
        document: TrustedDocument,
        replaces_session: bool,
    ) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.entry(id).or_default();
        entry.invalidate_external_reload();
        entry.pending_content = Some(content);
        entry.pending_trusted = Some(document);
        entry.pending_reload_revision = None;
        entry.pending_replaces_session = replaces_session;
        // 候选只写入本文档 entry，不清除其他文档的授权（跨文档落盘由 grant 归属保护）。
    }

    fn take_content(&self, id: &str) -> Option<Vec<u8>> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let (bytes, trusted, replaces_session) = {
            let entry = guard.documents.get_mut(id)?;
            let has_pending = entry.pending_content.is_some() && entry.pending_trusted.is_some();
            let reload_matches = match entry.pending_reload_revision {
                None => true,
                Some(revision) => entry.conflict.as_ref().is_some_and(|conflict| {
                    conflict.revision == revision && conflict.kind == ConflictKind::ContentChanged
                }),
            };
            let overwrite_allows_promotion = entry.pending_overwrite.is_none();
            if !has_pending || !reload_matches || !overwrite_allows_promotion {
                if has_pending {
                    entry.pending_content = None;
                    entry.pending_trusted = None;
                    entry.pending_reload_revision = None;
                    entry.pending_replaces_session = false;
                }
                return None;
            }

            let bytes = entry
                .pending_content
                .take()
                .expect("matching pending content must exist");
            let trusted = entry
                .pending_trusted
                .take()
                .expect("matching pending trusted must exist");
            let replaces_session = entry.pending_replaces_session;
            entry.pending_replaces_session = false;
            entry.invalidate_external_reload();
            (bytes, trusted, replaces_session)
        };
        if replaces_session {
            guard.documents.clear();
            guard.untitled_save_directory = None;
            guard.documents.insert(
                id.to_owned(),
                DocumentEntry {
                    active: Some(trusted),
                    ..DocumentEntry::default()
                },
            );
            return Some(bytes);
        }

        let entry = guard
            .documents
            .get_mut(id)
            .expect("promoted document entry must still exist");
        entry.pending_reload_revision = None;
        entry.active = Some(trusted);
        entry.conflict = None;
        entry.pending_save_directory = None;
        Some(bytes)
    }

    fn active_for(&self, id: &str) -> Option<TrustedDocument> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.get(id)?;
        if entry.pending_overwrite.is_some() {
            return None;
        }
        entry.active.clone()
    }

    /// 丢弃该文档尚未取回的候选内容缓冲。用于启动恢复推进前的有界化清理：正常协议下
    /// 前端已取回上一条目内容，此调用为 no-op；若调用方未取回就推进，后端仍保证任意
    /// 时刻至多一个恢复文件占用缓冲。
    pub(crate) fn discard_pending_content(&self, id: &str) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if let Some(entry) = guard.documents.get_mut(id) {
            entry.pending_content = None;
            entry.pending_trusted = None;
            entry.pending_reload_revision = None;
            entry.pending_replaces_session = false;
        }
    }

    /// 查找与给定路径身份一致的活动可信文档（启动恢复推进前的重复检查：中断期间用户
    /// 经普通 Open/Save As 打开的文件）。先在锁内快照活动 (id, path)，路径身份比较在
    /// 锁外执行；只匹配已提升的活动文档，候选缓冲路径由恢复游标自行跟踪。
    pub(crate) fn active_document_for_path(&self, path: &Path) -> Option<String> {
        let active_paths: Vec<(String, PathBuf)> = {
            let guard = self.inner.lock().expect("document store lock poisoned");
            guard
                .documents
                .iter()
                .filter(|(_, entry)| entry.pending_overwrite.is_none())
                .filter_map(|(id, entry)| {
                    entry
                        .active
                        .as_ref()
                        .map(|document| (id.clone(), document.path.clone()))
                })
                .collect()
        };
        active_paths
            .iter()
            .find(|(_, active_path)| same_path_identity(active_path, path))
            .map(|(id, _)| id.clone())
    }

    pub(crate) fn active_path(&self, id: &str) -> Option<PathBuf> {
        self.active_for(id).map(|document| document.path)
    }

    /// 把前端提交的有序文档 id 投影为 Rust 可信路径清单。整个投影持有一次 store 锁，
    /// 避免在逐 id 查询之间观察到标签关闭、另存为或覆盖租约变化后的混合快照。
    pub(crate) fn project_restore_manifest(
        &self,
        document_ids: &[String],
        active_document_id: Option<&str>,
    ) -> Result<RestoreManifest, ManifestProjectionError> {
        let mut unique_ids = std::collections::HashSet::with_capacity(document_ids.len());
        if document_ids
            .iter()
            .any(|document_id| !unique_ids.insert(document_id.as_str()))
        {
            return Err(ManifestProjectionError::DuplicateDocumentId);
        }

        let active_index = match active_document_id {
            Some(active_id) => Some(
                document_ids
                    .iter()
                    .position(|document_id| document_id == active_id)
                    .ok_or(ManifestProjectionError::ActiveDocumentNotInList)?,
            ),
            None => None,
        };

        let guard = self.inner.lock().expect("document store lock poisoned");
        let mut paths = Vec::with_capacity(document_ids.len());
        for document_id in document_ids {
            let path = guard
                .documents
                .get(document_id)
                .filter(|entry| entry.pending_overwrite.is_none())
                .and_then(|entry| entry.active.as_ref())
                .map(|document| document.path.clone())
                .ok_or(ManifestProjectionError::UnknownDocument)?;
            paths.push(path);
        }
        RestoreManifest::new(paths, active_index).map_err(ManifestProjectionError::InvalidManifest)
    }

    fn update_active(&self, id: &str, fingerprint: FileFingerprint, byte_count: u64) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let Some(entry) = guard.documents.get_mut(id) else {
            return;
        };
        if entry.pending_overwrite.is_some() {
            return;
        }
        if let Some(document) = entry.active.as_mut() {
            document.fingerprint = fingerprint;
            document.byte_count = byte_count;
            entry.conflict = None;
            entry.invalidate_external_reload();
        }
    }

    /// 另存为成功：把该文档关联到新目标（路径/显示名/编码/换行/指纹/字节数/只读），
    /// 沿用同一文档 id。id 不匹配时无操作（调用方应在已知 id 上调用）。
    fn reassociate_active(&self, id: &str, document: TrustedDocument) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if let Some(entry) = guard.documents.get_mut(id) {
            if entry.active.is_some() {
                entry.active = Some(document);
                entry.conflict = None;
                entry.invalidate_external_reload();
            }
        }
    }

    /// 首次保存成功：生成新文档 id 并建立可信关联，返回该 id。
    fn create_active(&self, document: TrustedDocument) -> String {
        let id = crate::document::next_document_id();
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.entry(id.clone()).or_default();
        entry.active = Some(document);
        entry.conflict = None;
        entry.pending_save_directory = None;
        entry.invalidate_external_reload();
        id
    }

    /// 普通保存冲突时记录待解决冲突状态，绑定该文档。必须存在匹配 id 的活动文档，否则
    /// 视为过期不记录。首次冲突不得更新可信指纹、字节数或描述信息——此处只记录状态。
    fn record_conflict(&self, id: &str, kind: ConflictKind, snapshot: Vec<u8>) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let trusted = match guard.documents.get(id) {
            Some(entry) if entry.pending_overwrite.is_none() => entry.active.clone(),
            _ => None,
        };
        let Some(trusted) = trusted else {
            return;
        };
        guard.next_conflict_revision = guard.next_conflict_revision.wrapping_add(1);
        let revision = guard.next_conflict_revision;
        if let Some(entry) = guard.documents.get_mut(id) {
            entry.invalidate_external_reload();
            entry.conflict = Some(ConflictState {
                revision,
                kind,
                snapshot,
                trusted,
            });
        }
    }

    /// 把监听复核建立的内容变化候选转换为既有版本化内容冲突。提升前再次确认磁盘仍是
    /// 候选快照，并在同一锁内校验活动基线、消费候选和保存前端编辑快照；过期、回退、
    /// 已关闭或已有其他冲突时返回 false；相同内容冲突已建立时幂等返回 true。
    fn record_external_conflict(&self, id: &str, snapshot: Vec<u8>) -> bool {
        // 同一标签在 IPC 往返期间可能收到更新的合并事件；优先追上最新候选，避免较早事件
        // 因世代过期而吞掉已经发布但被前端租约归并的较新通知。
        for _ in 0..4 {
            let candidate = {
                let guard = self.inner.lock().expect("document store lock poisoned");
                let Some(entry) = guard.documents.get(id) else {
                    return false;
                };
                if entry
                    .conflict
                    .as_ref()
                    .is_some_and(|conflict| conflict.kind == ConflictKind::ContentChanged)
                {
                    return true;
                }
                if entry.conflict.is_some()
                    || entry.pending_overwrite.is_some()
                    || entry.pending_reload_revision.is_some()
                {
                    return false;
                }
                let Some(candidate) = entry.pending_external_reload.clone() else {
                    return false;
                };
                if candidate.content.is_none()
                    || !entry.active.as_ref().is_some_and(|active| {
                        active.path == candidate.baseline_path
                            && active.fingerprint == candidate.baseline_fingerprint
                    })
                    || entry.external_check_generation != candidate.generation
                {
                    return false;
                }
                candidate
            };

            let disk_still_matches = crate::document::open_document(&candidate.baseline_path)
                .is_ok_and(|opened| {
                    opened.descriptor.fingerprint == candidate.trusted.fingerprint
                        && opened.descriptor.byte_count == candidate.trusted.byte_count
                        && opened.descriptor.encoding == candidate.trusted.encoding
                        && opened.descriptor.line_ending == candidate.trusted.line_ending
                        && opened.descriptor.read_only == candidate.trusted.read_only
                });

            let mut guard = self.inner.lock().expect("document store lock poisoned");
            let Some(entry) = guard.documents.get(id) else {
                return false;
            };
            if entry
                .conflict
                .as_ref()
                .is_some_and(|conflict| conflict.kind == ConflictKind::ContentChanged)
            {
                return true;
            }
            if entry.conflict.is_some() {
                return false;
            }
            let current_generation = entry
                .pending_external_reload
                .as_ref()
                .map(|pending| pending.generation);
            if current_generation.is_some_and(|generation| generation != candidate.generation) {
                drop(guard);
                continue;
            }
            let valid = disk_still_matches
                && entry.conflict.is_none()
                && entry.pending_overwrite.is_none()
                && entry.pending_reload_revision.is_none()
                && entry.external_check_generation == candidate.generation
                && entry
                    .pending_external_reload
                    .as_ref()
                    .is_some_and(|pending| {
                        pending.generation == candidate.generation && pending.content.is_some()
                    })
                && entry.active.as_ref().is_some_and(|active| {
                    active.path == candidate.baseline_path
                        && active.fingerprint == candidate.baseline_fingerprint
                });
            if !valid {
                if let Some(entry) = guard.documents.get_mut(id)
                    && entry
                        .pending_external_reload
                        .as_ref()
                        .is_some_and(|pending| pending.generation == candidate.generation)
                {
                    entry.invalidate_external_reload();
                }
                return false;
            }

            guard.next_conflict_revision = guard.next_conflict_revision.wrapping_add(1);
            let revision = guard.next_conflict_revision;
            let entry = guard
                .documents
                .get_mut(id)
                .expect("validated external conflict document must exist");
            let trusted = entry
                .active
                .clone()
                .expect("validated external conflict must have an active baseline");
            entry.invalidate_external_reload();
            entry.conflict = Some(ConflictState {
                revision,
                kind: ConflictKind::ContentChanged,
                snapshot,
                trusted,
            });
            return true;
        }
        false
    }

    /// 复核关联文档的磁盘目标并分类外部变化。复用 `open_document` 的指纹、严格编码、50 MiB 上限
    /// 与读取期间变化/原子替换保护建立一致快照。对内容或只读元数据变化，在对应 entry 中建立可原子
    /// 提升的重载候选（不替换活动状态）。未知/过期文档 id、文档已关闭或正在强制覆盖时返回 `None`，
    /// 不修改任何状态。
    #[allow(dead_code)]
    pub(crate) fn classify_external_change(&self, id: &str) -> Option<ExternalChange> {
        let check = self.begin_external_check(id)?;
        let observation = crate::document::open_document(&check.baseline.path);
        self.finish_external_check(id, check, observation)
    }

    pub(crate) fn external_change_signal(&self, id: &str) -> Option<ExternalDocumentChanged> {
        let (kind, error) = match self.classify_external_change(id)? {
            ExternalChange::ContentChanged => (ExternalDocumentChangeKind::Content, None),
            ExternalChange::MetadataChanged => (ExternalDocumentChangeKind::Metadata, None),
            ExternalChange::Missing => (ExternalDocumentChangeKind::Missing, None),
            ExternalChange::ReloadFailed(err) => (
                ExternalDocumentChangeKind::ReloadFailed,
                Some(DocumentCommandError::from_open_core(err)),
            ),
            ExternalChange::Unchanged => return None,
        };
        Some(ExternalDocumentChanged {
            document_id: id.to_owned(),
            kind,
            error,
        })
    }

    /// 为一次锁外磁盘读取保留单调世代。新复核一旦开始，先前尚未完成的结果即过期；冲突、
    /// 普通重载或强制覆盖期间不建立外部候选。
    fn begin_external_check(&self, id: &str) -> Option<ExternalCheck> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.get_mut(id)?;
        if entry.pending_overwrite.is_some()
            || entry.conflict.is_some()
            || entry.pending_reload_revision.is_some()
            || entry.pending_content.is_some()
            || entry.pending_trusted.is_some()
        {
            return None;
        }
        let baseline = entry.active.clone()?;
        entry.external_check_generation = entry.external_check_generation.wrapping_add(1);
        Some(ExternalCheck {
            generation: entry.external_check_generation,
            baseline,
        })
    }

    /// 只允许当前文档最近开始的复核发布结果。每个有效结果先替换整个候选槽，因此
    /// Unchanged/Missing/ReloadFailed 不会留下早先可被错误提升的快照。
    fn finish_external_check(
        &self,
        id: &str,
        check: ExternalCheck,
        observation: Result<document::OpenedDocument, DocumentError>,
    ) -> Option<ExternalChange> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.get_mut(id)?;
        if entry.pending_overwrite.is_some()
            || entry.conflict.is_some()
            || entry.pending_reload_revision.is_some()
            || entry.external_check_generation != check.generation
        {
            return None;
        }
        let still_valid = entry.active.as_ref().is_some_and(|active| {
            active.path == check.baseline.path && active.fingerprint == check.baseline.fingerprint
        });
        if !still_valid {
            return None;
        }

        entry.pending_external_reload = None;
        let change = match observation {
            Err(DocumentError::Io(err)) if err.kind() == std::io::ErrorKind::NotFound => {
                ExternalChange::Missing
            }
            Err(err) => ExternalChange::ReloadFailed(err),
            Ok(opened) => {
                let descriptor = opened.descriptor;
                let content_bytes = opened.content.into_bytes();
                let same_bytes = descriptor.fingerprint == check.baseline.fingerprint;
                let read_only_changed = descriptor.read_only != check.baseline.read_only;
                let new_trusted = TrustedDocument {
                    path: check.baseline.path.clone(),
                    display_name: check.baseline.display_name.clone(),
                    encoding: descriptor.encoding,
                    line_ending: descriptor.line_ending,
                    fingerprint: descriptor.fingerprint,
                    byte_count: descriptor.byte_count,
                    read_only: descriptor.read_only,
                };
                if same_bytes {
                    if !read_only_changed {
                        ExternalChange::Unchanged
                    } else {
                        entry.pending_external_reload = Some(ExternalReloadCandidate {
                            generation: check.generation,
                            baseline_fingerprint: check.baseline.fingerprint,
                            baseline_path: check.baseline.path.clone(),
                            trusted: new_trusted,
                            content: None,
                        });
                        ExternalChange::MetadataChanged
                    }
                } else {
                    entry.pending_external_reload = Some(ExternalReloadCandidate {
                        generation: check.generation,
                        baseline_fingerprint: check.baseline.fingerprint,
                        baseline_path: check.baseline.path.clone(),
                        trusted: new_trusted,
                        content: Some(content_bytes),
                    });
                    ExternalChange::ContentChanged
                }
            }
        };
        Some(change)
    }

    /// 原子提升已建立的外部重载候选。重新校验候选基线仍与活动可信状态一致；基线已变（过期）、
    /// 候选不存在、已有冲突或正在强制覆盖时返回 `None`，活动状态保持不变。成功时把活动可信元数据
    /// 推进到候选、清空候选，并返回新描述符与（仅内容变化时的）新内容。
    #[allow(dead_code)]
    fn prepare_external_reload(&self, id: &str) -> Option<ExternalReloadReady> {
        let candidate = {
            let mut guard = self.inner.lock().expect("document store lock poisoned");
            let entry = guard.documents.get_mut(id)?;
            if entry.pending_overwrite.is_some()
                || entry.conflict.is_some()
                || entry.pending_reload_revision.is_some()
            {
                entry.invalidate_external_reload();
                return None;
            }
            let candidate = entry.pending_external_reload.clone()?;
            let active = entry.active.as_ref()?;
            if active.path != candidate.baseline_path
                || active.fingerprint != candidate.baseline_fingerprint
                || entry.external_check_generation != candidate.generation
            {
                entry.invalidate_external_reload();
                return None;
            }
            candidate
        };

        // 分类与调用方决定是否采用候选之间可能跨越异步边界。提升前尽可能晚地重读可信路径，
        // 只在候选仍对应当前完整磁盘快照时提交，避免把随后到达的外部版本推进为旧指纹。
        let disk_still_matches = crate::document::open_document(&candidate.baseline_path)
            .is_ok_and(|opened| {
                opened.descriptor.fingerprint == candidate.trusted.fingerprint
                    && opened.descriptor.byte_count == candidate.trusted.byte_count
                    && opened.descriptor.encoding == candidate.trusted.encoding
                    && opened.descriptor.line_ending == candidate.trusted.line_ending
                    && opened.descriptor.read_only == candidate.trusted.read_only
            });

        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.get_mut(id)?;
        let candidate_is_current = entry
            .pending_external_reload
            .as_ref()
            .is_some_and(|pending| pending.generation == candidate.generation)
            && entry.external_check_generation == candidate.generation;
        if !disk_still_matches
            || !candidate_is_current
            || entry.pending_overwrite.is_some()
            || entry.conflict.is_some()
            || entry.pending_reload_revision.is_some()
            || !entry.active.as_ref().is_some_and(|active| {
                active.path == candidate.baseline_path
                    && active.fingerprint == candidate.baseline_fingerprint
            })
        {
            if candidate_is_current {
                entry.invalidate_external_reload();
            }
            return None;
        }
        let trusted = candidate.trusted.clone();
        let content_bytes = candidate.content.clone();
        let descriptor = trusted.to_descriptor(id, trusted.fingerprint.clone(), trusted.byte_count);
        entry.invalidate_external_reload();
        match content_bytes {
            Some(bytes) => {
                entry.pending_content = Some(bytes);
                entry.pending_trusted = Some(trusted);
                entry.pending_reload_revision = None;
                entry.pending_replaces_session = false;
                Some(ExternalReloadReady::Content { descriptor })
            }
            None => {
                entry.active = Some(trusted);
                Some(ExternalReloadReady::Metadata { descriptor })
            }
        }
    }

    fn retry_external_reload(&self, id: &str) -> Option<ExternalReloadRetry> {
        match self.classify_external_change(id)? {
            ExternalChange::ContentChanged | ExternalChange::MetadataChanged => self
                .prepare_external_reload(id)
                .map(|reload| ExternalReloadRetry::Ready { reload })
                .or(Some(ExternalReloadRetry::Unchanged)),
            ExternalChange::Missing => Some(ExternalReloadRetry::Missing),
            ExternalChange::ReloadFailed(err) => Some(ExternalReloadRetry::Failed {
                error: DocumentCommandError::from_open_core(err),
            }),
            ExternalChange::Unchanged => Some(ExternalReloadRetry::Unchanged),
        }
    }

    #[cfg(test)]
    fn take_external_reload(&self, id: &str) -> Option<ExternalReload> {
        match self.prepare_external_reload(id)? {
            ExternalReloadReady::Content { descriptor } => {
                let bytes = self.take_content(id)?;
                Some(ExternalReload::Content {
                    descriptor,
                    content: String::from_utf8(bytes).expect("candidate content is valid UTF-8"),
                })
            }
            ExternalReloadReady::Metadata { descriptor } => {
                Some(ExternalReload::Metadata { descriptor })
            }
        }
    }

    /// 测试辅助：该文档是否挂有未提升的外部重载候选。
    #[cfg(test)]
    fn has_pending_external_reload(&self, id: &str) -> bool {
        let guard = self.inner.lock().expect("document store lock poisoned");
        guard
            .documents
            .get(id)
            .is_some_and(|entry| entry.pending_external_reload.is_some())
    }

    /// 测试辅助：读取但不消费该文档当前冲突。真实解决命令必须在成功或明确取消后才清除
    /// 状态，不能在可能失败的文件 I/O 之前把冲突标记为已解决。
    #[cfg(test)]
    fn conflict_for(&self, id: &str) -> Option<ConflictState> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        guard
            .documents
            .get(id)
            .and_then(|entry| entry.conflict.clone())
    }

    /// 取得该文档的内容变化冲突。返回内部快照但不消费状态；重新加载失败时用户仍可重试
    /// 或取消。目标缺失冲突必须走独立的保留/关闭流程。
    fn content_conflict_for(&self, id: &str) -> Option<ConflictState> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        guard
            .documents
            .get(id)
            .and_then(|entry| entry.conflict.as_ref())
            .filter(|conflict| conflict.kind == ConflictKind::ContentChanged)
            .cloned()
    }

    /// 明确取消该文档的内容变化冲突。不执行文件 I/O，不影响活动文档或内容。
    /// 未知、过期、已解决或其他类型的冲突返回 false。
    fn clear_content_conflict(&self, id: &str) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let Some(entry) = guard.documents.get_mut(id) else {
            return false;
        };
        let revision = entry
            .conflict
            .as_ref()
            .filter(|conflict| conflict.kind == ConflictKind::ContentChanged)
            .map(|conflict| conflict.revision);
        let Some(revision) = revision else {
            return false;
        };
        if entry
            .pending_overwrite
            .is_some_and(|pending_revision| pending_revision == revision)
        {
            return false;
        }

        entry.conflict = None;
        if entry
            .pending_reload_revision
            .is_some_and(|pending_revision| pending_revision == revision)
        {
            entry.pending_content = None;
            entry.pending_trusted = None;
            entry.pending_reload_revision = None;
        }
        true
    }

    /// 为该文档的内容冲突取得强制覆盖租约。快照在租约建立后返回，失败或成功提交前都不
    /// 消费冲突；同一时刻每个文档只允许一个覆盖操作。
    fn begin_overwrite(&self, id: &str) -> Option<ConflictState> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.get_mut(id)?;
        if entry.pending_overwrite.is_some() || entry.pending_reload_revision.is_some() {
            return None;
        }
        let conflict = entry
            .conflict
            .as_ref()
            .filter(|conflict| conflict.kind == ConflictKind::ContentChanged)?
            .clone();
        entry.pending_overwrite = Some(conflict.revision);
        Some(conflict)
    }

    /// 覆盖 I/O 失败时仅释放该文档的匹配租约，保留原冲突供用户重试或取消。
    fn abort_overwrite(&self, id: &str, revision: u64) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let Some(entry) = guard.documents.get_mut(id) else {
            return false;
        };
        let matches = entry
            .pending_overwrite
            .is_some_and(|pending_revision| pending_revision == revision);
        if matches {
            entry.pending_overwrite = None;
        }
        matches
    }

    /// 覆盖成功后，在同一锁内复核该文档活动状态、冲突版本与租约，再更新可信状态并清除冲突。
    fn commit_overwrite(
        &self,
        id: &str,
        revision: u64,
        fingerprint: FileFingerprint,
        byte_count: u64,
    ) -> Option<TrustedDocument> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let entry = guard.documents.get_mut(id)?;
        let still_current = entry.active.is_some()
            && entry.conflict.as_ref().is_some_and(|conflict| {
                conflict.revision == revision && conflict.kind == ConflictKind::ContentChanged
            })
            && entry
                .pending_overwrite
                .is_some_and(|pending_revision| pending_revision == revision);
        if !still_current {
            return None;
        }

        let document = entry
            .active
            .as_mut()
            .expect("matching active document must exist");
        document.fingerprint = fingerprint;
        document.byte_count = byte_count;
        let updated = document.clone();
        entry.conflict = None;
        entry.pending_overwrite = None;
        Some(updated)
    }

    /// 重新加载成功后，把新内容和更新后的可信描述缓冲为该文档候选，供
    /// `read_document_content` 取回。取回时 `take_content` 会原子提升为活动文档并清除
    /// 冲突状态——因此冲突状态在内容被前端成功取回前不会被标记为已解决。
    fn prepare_reload(
        &self,
        id: &str,
        revision: u64,
        content: Vec<u8>,
        document: TrustedDocument,
    ) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let Some(entry) = guard.documents.get_mut(id) else {
            return false;
        };
        let still_current = entry.active.is_some()
            && entry.conflict.as_ref().is_some_and(|conflict| {
                conflict.revision == revision && conflict.kind == ConflictKind::ContentChanged
            })
            && entry.pending_overwrite.is_none();
        if !still_current {
            return false;
        }
        entry.pending_content = Some(content);
        entry.pending_trusted = Some(document);
        entry.pending_reload_revision = Some(revision);
        true
    }

    /// 返回该文档的可信路径（不读取内容）。用于聚焦时检查文件是否仍存在。
    fn active_path_for(&self, id: &str) -> Option<PathBuf> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        guard
            .documents
            .get(id)
            .and_then(|entry| entry.active.as_ref())
            .map(|document| document.path.clone())
    }

    /// 关闭文档：从 map 移除该 id 的整个 entry（候选/活动/冲突/覆盖租约/授权一并清除）。
    /// entry 不存在返回 false。
    fn close_active(&self, id: &str) -> bool {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        guard.documents.remove(id).is_some()
    }

    /// 发放一个新的保存目录授权。有文档 id 时写入该文档 entry（覆盖其既有授权）；无 id
    /// （Untitled）写入全局 Untitled 槽，始终允许——多标签下 Untitled 标签可与文件标签
    /// 共存，不再要求后端没有任何活动文档。安全性来自 grant 系统：目录只能由后端发放。
    fn establish_save_grant(
        &self,
        document_id: Option<String>,
        path: PathBuf,
        display_name: String,
    ) -> Result<SaveDirectoryGrant, DocumentCommandError> {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        let context_matches = match document_id.as_deref() {
            Some(requested_id) => guard
                .documents
                .get(requested_id)
                .is_some_and(|entry| entry.pending_overwrite.is_none() && entry.active.is_some()),
            None => true,
        };
        if !context_matches {
            return Err(DocumentCommandError::new(
                DocumentErrorCode::UnknownDocument,
                "save directory grant cannot be attached to a stale document context",
            ));
        }
        let id = format!("save-dir-{}", guard.next_save_directory_id);
        guard.next_save_directory_id = guard.next_save_directory_id.saturating_add(1);
        let requested_id = document_id.clone();
        let pending = PendingSaveDirectory {
            grant_id: id.clone(),
            document_id,
            path,
        };
        match requested_id.as_deref() {
            Some(requested_id) => {
                if let Some(entry) = guard.documents.get_mut(requested_id) {
                    entry.pending_save_directory = Some(pending);
                }
            }
            None => guard.untitled_save_directory = Some(pending),
        }
        Ok(SaveDirectoryGrant { id, display_name })
    }

    /// 清除指定文档上下文的保存目录授权：有 id 清该 entry，无 id（Untitled）清全局槽。
    fn clear_save_grant(&self, document_id: Option<&str>) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        match document_id {
            Some(id) => {
                if let Some(entry) = guard.documents.get_mut(id) {
                    entry.pending_save_directory = None;
                }
            }
            None => guard.untitled_save_directory = None,
        }
    }

    /// 读取匹配 `grant_id` 的授权（克隆）。在所有 entry 与 Untitled 槽中查找；不存在或已过期返回 `None`。
    fn current_save_grant(&self, grant_id: &str) -> Option<PendingSaveDirectory> {
        let guard = self.inner.lock().expect("document store lock poisoned");
        if guard
            .untitled_save_directory
            .as_ref()
            .is_some_and(|pending| pending.grant_id == grant_id)
        {
            return guard.untitled_save_directory.clone();
        }
        guard
            .documents
            .values()
            .filter_map(|entry| entry.pending_save_directory.as_ref())
            .find(|pending| pending.grant_id == grant_id)
            .cloned()
    }

    /// 成功落盘后消费授权（单次使用）。按 `grant_id` 在所有 entry 与 Untitled 槽中查找并清除。
    fn take_save_grant(&self, grant_id: &str) {
        let mut guard = self.inner.lock().expect("document store lock poisoned");
        if guard
            .untitled_save_directory
            .as_ref()
            .is_some_and(|pending| pending.grant_id == grant_id)
        {
            guard.untitled_save_directory = None;
            return;
        }
        for entry in guard.documents.values_mut() {
            if entry
                .pending_save_directory
                .as_ref()
                .is_some_and(|pending| pending.grant_id == grant_id)
            {
                entry.pending_save_directory = None;
                return;
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

fn normalize_identity_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn canonical_identity_path(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path)
        .ok()
        .map(|path| normalize_identity_path(&path))
}

fn same_path_identity(left: &Path, right: &Path) -> bool {
    normalize_identity_path(left) == normalize_identity_path(right)
        || match (
            canonical_identity_path(left),
            canonical_identity_path(right),
        ) {
            (Some(left), Some(right)) => left == right,
            _ => false,
        }
}

fn known_document_for_path(path: &Path, known_documents: &[KnownDocumentPath]) -> Option<String> {
    known_documents
        .iter()
        .find(|known| same_path_identity(path, &known.path))
        .map(|known| known.tab_id.clone())
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
    known_documents: Vec<KnownDocumentPath>,
    app: tauri::AppHandle,
    state: tauri::State<'_, DocumentStore>,
) -> Result<Option<OpenDocumentSelection>, DocumentCommandError> {
    let Some(selected) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "selected file path is unavailable",
        )
    })?;
    if let Some(tab_id) = known_document_for_path(&path, &known_documents) {
        return Ok(Some(OpenDocumentSelection::Existing { tab_id }));
    }
    open_selected_path(&path, state.inner())
        .map(|descriptor| Some(OpenDocumentSelection::Opened { descriptor }))
}

/// 以原始二进制返回最近一次打开的文档内容。文档 ID 必须与打开时一致；取出后缓冲即清空。
#[tauri::command]
pub fn read_document_content(
    id: String,
    state: tauri::State<'_, DocumentStore>,
    watcher: tauri::State<'_, crate::external_watch::ExternalWatchService>,
) -> Result<tauri::ipc::Response, DocumentCommandError> {
    match state.take_content(&id) {
        Some(bytes) => {
            if let Some(path) = state.active_path(&id) {
                watcher.associate(&id, &path);
            }
            Ok(tauri::ipc::Response::new(bytes))
        }
        None => Err(DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "no buffered content is available for the requested document",
        )),
    }
}

/// 启动恢复的一次推进。首次调用读取 Rust 自有清单并返回 `Started`（缺失、损坏或读取
/// 失败直接 `Done`）；此后每次调用至多打开一个清单文件并返回 `Item`（进入候选缓冲，由
/// 前端经二进制通道取回）或 `Failed`，全部处理完返回 `Done`。同一路径/符号链接别名只
/// 恢复首个出现位置；推进前清除上一条尚未取回的缓冲，保证恢复内存有界于单个文件。
fn restore_session_step(
    cursor: &SessionRestoreCursor,
    store: &DocumentStore,
    manifests: &SessionManifestStore,
) -> SessionRestoreStep {
    let mut inner = cursor
        .inner
        .lock()
        .expect("session restore cursor lock poisoned");
    if !inner.started {
        inner.started = true;
        return match manifests.load() {
            ManifestLoadOutcome::Ready(manifest) => {
                let total = manifest.files().len();
                let active_index = manifest.active_index();
                inner.manifest = Some(manifest);
                SessionRestoreStep::Started {
                    total,
                    active_index,
                }
            }
            ManifestLoadOutcome::Missing
            | ManifestLoadOutcome::Invalid
            | ManifestLoadOutcome::ReadFailed => {
                inner.finished = true;
                SessionRestoreStep::Done
            }
        };
    }
    if inner.finished {
        return SessionRestoreStep::Done;
    }
    loop {
        let Some(path) = inner
            .manifest
            .as_ref()
            .and_then(|manifest| manifest.files().get(inner.next_index).cloned())
        else {
            inner.finished = true;
            return SessionRestoreStep::Done;
        };
        let index = inner.next_index;
        // 同一路径或符号链接别名只恢复首个出现位置，不建立重复标签或重复后端文档。
        if inner
            .accepted_paths
            .iter()
            .any(|accepted| same_path_identity(accepted, &path))
        {
            inner.next_index += 1;
            continue;
        }
        // 中断期间经普通 Open/Save As 已打开同一路径身份：映射到现有文档，不重复
        // 读取或建立第二个后端文档；前端据此把清单索引映射到现有标签。
        if let Some(document_id) = store.active_document_for_path(&path) {
            inner.accepted_paths.push(path.clone());
            inner.next_index = index + 1;
            return SessionRestoreStep::AlreadyOpen {
                document_id,
                manifest_index: index,
            };
        }
        // 有界化：确定要打开下一个文件时，先释放上一条尚未取回的候选缓冲——无论前端
        // 行为如何，后端同时至多缓冲一个恢复文件；清单耗尽时最后一条保留供前端取回。
        if let Some(buffered_id) = inner.buffered_document_id.take() {
            store.discard_pending_content(&buffered_id);
        }
        return match document::open_document(&path) {
            Ok(opened) => {
                let trusted = trusted_from_descriptor(&opened.descriptor);
                store.store_open(
                    opened.descriptor.id.clone(),
                    opened.content.into_bytes(),
                    trusted,
                );
                inner.accepted_paths.push(path.clone());
                inner.next_index = index + 1;
                inner.buffered_document_id = Some(opened.descriptor.id.clone());
                SessionRestoreStep::Item {
                    descriptor: opened.descriptor,
                    manifest_index: index,
                }
            }
            Err(err) => {
                inner.next_index = index + 1;
                SessionRestoreStep::Failed {
                    display_name: display_name_of(&path),
                    error: DocumentCommandError::from_open_core(err),
                }
            }
        };
    }
}

/// 把前端投影写入清单：先在锁内从可信状态投影路径（未知/重复文档 id 或未列出的活动 id
/// 一律拒绝，视为过期快照，不消费 generation），再按 generation 门禁原子写入。只有真实
/// 写入失败返回稳定错误；文档状态不受影响。
fn update_open_files_manifest_inner(
    store: &DocumentStore,
    manifests: &SessionManifestStore,
    generation: u64,
    document_ids: &[String],
    active_document_id: Option<&str>,
) -> Result<SessionManifestUpdateStatus, DocumentCommandError> {
    let manifest = match store.project_restore_manifest(document_ids, active_document_id) {
        Ok(manifest) => manifest,
        Err(_) => return Ok(SessionManifestUpdateStatus::Rejected),
    };
    match manifests.update(generation, &manifest) {
        Ok(ManifestUpdateOutcome::Written) => Ok(SessionManifestUpdateStatus::Written),
        Ok(ManifestUpdateOutcome::Stale) => Ok(SessionManifestUpdateStatus::Stale),
        Err(_) => Err(DocumentCommandError::new(
            DocumentErrorCode::SessionManifestWriteFailed,
            "open-files manifest could not be written",
        )),
    }
}

/// 启动恢复的逐项推进命令：只能读取 Rust 自有清单中的路径，前端不能提交任何路径。
/// 首次调用返回清单概要，此后每次推进至多打开一个文件并进入候选缓冲（取回经既有二进制
/// `read_document_content`）；文件 I/O 在阻塞线程执行，不冻结主线程。
#[tauri::command]
pub async fn restore_next_session_document(
    app: tauri::AppHandle,
) -> Result<SessionRestoreStep, DocumentCommandError> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cursor = handle.state::<SessionRestoreCursor>();
        let store = handle.state::<DocumentStore>();
        // 清单存储不可用（应用数据目录解析失败）视同无可恢复清单，不阻塞启动。
        match handle.try_state::<SessionManifestStore>() {
            Some(manifests) => Ok(restore_session_step(&cursor, &store, &manifests)),
            None => Ok(SessionRestoreStep::Done),
        }
    })
    .await
    .map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::ReadFailed,
            "session restore worker could not complete",
        )
    })?
}

/// 前端在打开、另存为、关闭标签或活动标签变化后提交的清单投影更新。迟到 generation
/// 与过期投影被静默忽略；只有真实写入失败返回错误，供前端显示非模态提示。
#[tauri::command]
pub async fn update_open_files_manifest(
    app: tauri::AppHandle,
    projection: SessionManifestProjection,
) -> Result<SessionManifestUpdateStatus, DocumentCommandError> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = handle.state::<DocumentStore>();
        // 清单存储不可用时按写入失败报告；文档状态不受影响。
        let Some(manifests) = handle.try_state::<SessionManifestStore>() else {
            return Err(DocumentCommandError::new(
                DocumentErrorCode::SessionManifestWriteFailed,
                "open-files manifest storage is unavailable",
            ));
        };
        update_open_files_manifest_inner(
            &store,
            &manifests,
            projection.generation,
            &projection.document_ids,
            projection.active_document_id.as_deref(),
        )
    })
    .await
    .map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::SessionManifestWriteFailed,
            "open-files manifest worker could not complete",
        )
    })?
}

/// 采用最近一次外部变化复核建立的候选。内容变化只返回描述符，并把完整 UTF-8 内容
/// 暂存到现有二进制读取通道；元数据变化直接原子推进活动描述符。
#[tauri::command]
pub fn prepare_external_reload(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<Option<ExternalReloadReady>, DocumentCommandError> {
    Ok(state.prepare_external_reload(&id))
}

/// 用户从实时重载失败提示点击 Retry 后，重新复核可信目标并尽可能采用新候选。
#[tauri::command]
pub fn retry_external_reload(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<Option<ExternalReloadRetry>, DocumentCommandError> {
    Ok(state.retry_external_reload(&id))
}

/// 聚焦/恢复时按可信文档 ID 复核单个已关联标签，返回与实时监听相同的安全变化信号。
#[tauri::command]
pub fn refresh_external_document(
    id: String,
    state: tauri::State<'_, DocumentStore>,
) -> Result<Option<ExternalDocumentChanged>, DocumentCommandError> {
    Ok(state.external_change_signal(&id))
}

/// 脏标签采用监听产生的内容变化信号时，把当前完整编辑快照绑定为既有内容冲突。
/// 文档正文继续使用 Raw body，前端只能通过可信文档 id 指定目标。
#[tauri::command]
pub fn prepare_external_conflict(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, DocumentStore>,
) -> Result<bool, DocumentCommandError> {
    let id = request
        .headers()
        .get(DOCUMENT_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            DocumentCommandError::new(
                DocumentErrorCode::UnknownDocument,
                "external conflict request is missing the document id header",
            )
        })?;
    let snapshot = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => {
            return Err(DocumentCommandError::new(
                DocumentErrorCode::ReadFailed,
                "external conflict content must be sent as a raw byte body",
            ));
        }
    };
    std::str::from_utf8(&snapshot).map_err(|_| {
        DocumentCommandError::new(
            DocumentErrorCode::UnsupportedEncoding,
            "external conflict content is not valid UTF-8",
        )
    })?;
    Ok(state.record_external_conflict(id, snapshot))
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
    watcher: tauri::State<'_, crate::external_watch::ExternalWatchService>,
) -> Result<(), DocumentCommandError> {
    if state.close_active(&id) {
        watcher.remove(&id);
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

/// 解析内嵌另存为的可信文档上下文。有活动文档时必须提交其 id（返回其可信描述）；
/// Untitled（`None`）始终成立并返回 `None`——多标签下 Untitled 标签可与文件标签共存，
/// 不再要求后端没有任何活动文档。安全性来自 grant 系统：保存目录只能由后端发放，
/// 前端无法提交任意路径。
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
        None => Ok(None),
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
    current_tab_id: Option<&str>,
    known_documents: &[KnownDocumentPath],
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
    let occupied_tab_id = known_documents
        .iter()
        .find(|known| {
            Some(known.tab_id.as_str()) != current_tab_id && same_path_identity(&path, &known.path)
        })
        .map(|known| known.tab_id.clone());
    Ok(TargetPreview {
        exists,
        is_current_path,
        occupied_tab_id,
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
            store.clear_save_grant(document_id.as_deref());
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
    current_tab_id: String,
    known_documents: Vec<KnownDocumentPath>,
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
    preview_target(
        &grant.path,
        &file_name,
        trusted_opt.as_ref(),
        Some(&current_tab_id),
        &known_documents,
    )
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
    watcher: tauri::State<'_, crate::external_watch::ExternalWatchService>,
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

    let descriptor = save_document_as_at_inner(
        state.inner(),
        id_opt.as_deref(),
        &directory_id,
        &file_name,
        encoding,
        line_ending,
        content,
    )
    .await?;
    if let Some(path) = state.active_path(&descriptor.id) {
        watcher.associate(&descriptor.id, &path);
    }
    Ok(descriptor)
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

        // 新候选写入独立 entry，不影响旧活动文档；多文档并发共存，提升只作用于请求 id。
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
        // 候选未取回前，doc-1 仍活动、doc-next 尚未提升。
        assert!(store.active_for("doc-1").is_some());
        assert!(store.active_for("doc-next").is_none());
        // 错误 id 取回失败，不影响任一文档。
        assert!(store.take_content("wrong-id").is_none());
        assert!(store.active_for("doc-1").is_some());
        // 提升 doc-next 只作用于 doc-next，doc-1 继续保持活动（多文档并发）。
        assert_eq!(store.take_content("doc-next"), Some(b"next".to_vec()));
        assert!(store.active_for("doc-1").is_some());
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
    fn restore_manifest_projection_uses_trusted_paths_order_and_active_index() {
        let store = DocumentStore::default();
        let first = store.create_active(test_trusted("/tmp/first.txt"));
        let second = store.create_active(test_trusted("/tmp/second.md"));

        let projected = store
            .project_restore_manifest(&[second.clone(), first.clone()], Some(&first))
            .expect("project trusted paths");

        assert_eq!(
            projected.files(),
            [
                PathBuf::from("/tmp/second.md"),
                PathBuf::from("/tmp/first.txt")
            ]
        );
        assert_eq!(projected.active_index(), Some(1));
    }

    #[test]
    fn restore_manifest_projection_rejects_unknown_duplicate_and_unlisted_active_ids() {
        let store = DocumentStore::default();
        let active = store.create_active(test_trusted("/tmp/active.txt"));

        assert_eq!(
            store.project_restore_manifest(&["missing".to_owned()], None),
            Err(ManifestProjectionError::UnknownDocument)
        );
        assert_eq!(
            store.project_restore_manifest(&[active.clone(), active.clone()], Some(&active)),
            Err(ManifestProjectionError::DuplicateDocumentId)
        );
        assert_eq!(
            store.project_restore_manifest(std::slice::from_ref(&active), Some("other")),
            Err(ManifestProjectionError::ActiveDocumentNotInList)
        );
    }

    #[test]
    fn restore_steps_open_files_one_at_a_time_in_manifest_order() {
        use crate::document::test_support::TestDir;
        use crate::session_restore::{RestoreManifest, SessionManifestStore};

        let dir = TestDir::new();
        std::fs::write(dir.join("first.txt"), b"first").unwrap();
        std::fs::write(dir.join("second.md"), b"second").unwrap();
        let manifests = SessionManifestStore::at_path(dir.join("session.json"));
        let manifest =
            RestoreManifest::new(vec![dir.join("first.txt"), dir.join("second.md")], Some(1))
                .unwrap();
        manifests.update(1, &manifest).unwrap();

        let cursor = SessionRestoreCursor::default();
        let store = DocumentStore::default();

        // 首次推进只读取清单概要，不打开文件。
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Started {
                total: 2,
                active_index: Some(1)
            }
        );
        let SessionRestoreStep::Item {
            descriptor: first,
            manifest_index: 0,
        } = restore_session_step(&cursor, &store, &manifests)
        else {
            panic!("first file must open");
        };
        assert_eq!(first.display_name, "first.txt");
        // 内容进入候选缓冲，经既有二进制通道取回后提升为可信文档。
        assert_eq!(store.take_content(&first.id), Some(b"first".to_vec()));
        assert!(store.active_for(&first.id).is_some());

        let SessionRestoreStep::Item {
            descriptor: second,
            manifest_index: 1,
        } = restore_session_step(&cursor, &store, &manifests)
        else {
            panic!("second file must open");
        };
        assert_eq!(store.take_content(&second.id), Some(b"second".to_vec()));

        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );
        // 一次性恢复：完成后继续推进不再重开文件。
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );
    }

    #[cfg(unix)]
    #[test]
    fn restore_steps_skip_duplicate_aliases_and_report_missing_failures() {
        use crate::document::test_support::TestDir;
        use crate::session_restore::{RestoreManifest, SessionManifestStore};
        use std::os::unix::fs::symlink;

        let dir = TestDir::new();
        std::fs::write(dir.join("real.txt"), b"real").unwrap();
        symlink(dir.join("real.txt"), dir.join("alias.txt")).unwrap();
        let manifests = SessionManifestStore::at_path(dir.join("session.json"));
        let manifest = RestoreManifest::new(
            vec![
                dir.join("real.txt"),
                dir.join("missing.txt"),
                dir.join("alias.txt"),
            ],
            None,
        )
        .unwrap();
        manifests.update(1, &manifest).unwrap();

        let cursor = SessionRestoreCursor::default();
        let store = DocumentStore::default();
        assert!(matches!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Started { .. }
        ));
        let SessionRestoreStep::Item { manifest_index, .. } =
            restore_session_step(&cursor, &store, &manifests)
        else {
            panic!("real file must open");
        };
        assert_eq!(manifest_index, 0);
        let SessionRestoreStep::Failed {
            display_name,
            error,
        } = restore_session_step(&cursor, &store, &manifests)
        else {
            panic!("missing file must fail");
        };
        assert_eq!(display_name, "missing.txt");
        assert!(matches!(error.code, DocumentErrorCode::ReadFailed));
        // 符号链接别名被跳过，不产生重复项或重复失败。
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );
    }

    #[test]
    fn restore_steps_map_already_open_documents_instead_of_duplicating() {
        use crate::document::test_support::TestDir;
        use crate::session_restore::{RestoreManifest, SessionManifestStore};

        let dir = TestDir::new();
        std::fs::write(dir.join("a.txt"), b"alpha").unwrap();
        std::fs::write(dir.join("b.txt"), b"beta").unwrap();
        let manifests = SessionManifestStore::at_path(dir.join("session.json"));
        let manifest =
            RestoreManifest::new(vec![dir.join("a.txt"), dir.join("b.txt")], Some(1)).unwrap();
        manifests.update(1, &manifest).unwrap();

        let cursor = SessionRestoreCursor::default();
        let store = DocumentStore::default();
        assert!(matches!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Started { .. }
        ));
        let SessionRestoreStep::Item {
            descriptor: first,
            manifest_index: 0,
        } = restore_session_step(&cursor, &store, &manifests)
        else {
            panic!("first file must open");
        };
        // 中断前第一项内容已被取回（提升为活动文档）。
        assert_eq!(store.take_content(&first.id), Some(b"alpha".to_vec()));

        // 中断：用户经普通 Open 打开下一清单文件 b（既有打开链路）。
        let opened = open_selected_path(&dir.join("b.txt"), &store).expect("open b");
        assert_eq!(store.take_content(&opened.id), Some(b"beta".to_vec()));

        // Retry：b 不被重复打开，而是映射到现有文档。
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::AlreadyOpen {
                document_id: opened.id.clone(),
                manifest_index: 1,
            }
        );
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );
        // Retry 完成后的投影含两个文档 id，不因路径重复被拒绝。
        assert_eq!(
            update_open_files_manifest_inner(
                &store,
                &manifests,
                2,
                &[first.id.clone(), opened.id.clone()],
                Some(&opened.id),
            ),
            Ok(SessionManifestUpdateStatus::Written)
        );
    }

    #[cfg(unix)]
    #[test]
    fn restore_steps_recognize_symlink_aliases_of_already_open_documents() {
        use crate::document::test_support::TestDir;
        use crate::session_restore::{RestoreManifest, SessionManifestStore};
        use std::os::unix::fs::symlink;

        let dir = TestDir::new();
        std::fs::write(dir.join("real.txt"), b"real").unwrap();
        symlink(dir.join("real.txt"), dir.join("alias.txt")).unwrap();
        let manifests = SessionManifestStore::at_path(dir.join("session.json"));
        let manifest = RestoreManifest::new(vec![dir.join("alias.txt")], None).unwrap();
        manifests.update(1, &manifest).unwrap();

        let cursor = SessionRestoreCursor::default();
        let store = DocumentStore::default();
        // 中断期间用户直接打开了真实路径。
        let opened = open_selected_path(&dir.join("real.txt"), &store).expect("open real");
        assert_eq!(store.take_content(&opened.id), Some(b"real".to_vec()));

        assert!(matches!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Started { .. }
        ));
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::AlreadyOpen {
                document_id: opened.id.clone(),
                manifest_index: 0,
            }
        );
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );
    }

    #[test]
    fn restore_steps_keep_at_most_one_buffered_file_regardless_of_client() {
        use crate::document::test_support::TestDir;
        use crate::session_restore::{RestoreManifest, SessionManifestStore};

        // 资源边界：即使调用方从不取回内容就连续推进，后端每次推进都先释放上一条
        // 缓冲，任意时刻至多一个已打开文件占用内存。
        let dir = TestDir::new();
        let payload = vec![b'x'; 512 * 1024];
        let names = ["big-a.bin", "big-b.bin", "big-c.bin"];
        for name in names {
            std::fs::write(dir.join(name), &payload).unwrap();
        }
        let manifests = SessionManifestStore::at_path(dir.join("session.json"));
        let manifest =
            RestoreManifest::new(names.iter().map(|name| dir.join(name)).collect(), None).unwrap();
        manifests.update(1, &manifest).unwrap();

        let cursor = SessionRestoreCursor::default();
        let store = DocumentStore::default();
        assert!(matches!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Started { total: 3, .. }
        ));
        let mut ids = Vec::new();
        for expected in 0..names.len() {
            match restore_session_step(&cursor, &store, &manifests) {
                SessionRestoreStep::Item {
                    descriptor,
                    manifest_index,
                } => {
                    assert_eq!(manifest_index, expected);
                    ids.push(descriptor.id);
                }
                step => panic!("unexpected step at {expected}: {step:?}"),
            }
        }
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );
        // 只有最后一条缓冲保留；此前未取回的候选均已在推进时释放。
        for id in &ids[..ids.len() - 1] {
            assert_eq!(store.take_content(id), None);
        }
        assert_eq!(
            store.take_content(ids.last().unwrap()),
            Some(payload.clone())
        );
    }

    #[test]
    fn restore_steps_finish_for_missing_or_invalid_manifests() {
        use crate::document::test_support::TestDir;
        use crate::session_restore::SessionManifestStore;

        let dir = TestDir::new();
        let manifests = SessionManifestStore::at_path(dir.join("session.json"));
        let cursor = SessionRestoreCursor::default();
        let store = DocumentStore::default();
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );
        // 一次性门禁已消费：即使清单随后出现也不再恢复。
        std::fs::write(dir.join("session.json"), br#"{"version":1,"files":[]}"#).unwrap();
        assert_eq!(
            restore_session_step(&cursor, &store, &manifests),
            SessionRestoreStep::Done
        );

        let invalid = SessionManifestStore::at_path(dir.join("broken.json"));
        std::fs::write(dir.join("broken.json"), b"{not-json").unwrap();
        assert_eq!(
            restore_session_step(&SessionRestoreCursor::default(), &store, &invalid),
            SessionRestoreStep::Done
        );
    }

    #[test]
    fn manifest_update_writes_projection_and_rejects_stale_or_expired_inputs() {
        use crate::session_restore::{ManifestLoadOutcome, SessionManifestStore};

        let dir = crate::document::test_support::TestDir::new();
        let manifests = SessionManifestStore::at_path(dir.join("session.json"));
        let store = DocumentStore::default();
        let first = store.create_active(test_trusted("/tmp/first.txt"));
        let second = store.create_active(test_trusted("/tmp/second.txt"));

        assert_eq!(
            update_open_files_manifest_inner(
                &store,
                &manifests,
                3,
                &[first.clone(), second.clone()],
                Some(&second),
            ),
            Ok(SessionManifestUpdateStatus::Written)
        );
        // 迟到/重复 generation 被忽略，磁盘保持最新集合。
        assert_eq!(
            update_open_files_manifest_inner(&store, &manifests, 3, &[first.clone()], Some(&first)),
            Ok(SessionManifestUpdateStatus::Stale)
        );
        // 过期投影（未知文档 id）被拒绝且不消费 generation；同代有效投影仍可写入。
        assert_eq!(
            update_open_files_manifest_inner(&store, &manifests, 4, &["gone".to_owned()], None),
            Ok(SessionManifestUpdateStatus::Rejected)
        );
        assert_eq!(
            update_open_files_manifest_inner(&store, &manifests, 4, &[first.clone()], Some(&first)),
            Ok(SessionManifestUpdateStatus::Written)
        );

        match manifests.load() {
            ManifestLoadOutcome::Ready(manifest) => {
                assert_eq!(manifest.files(), [PathBuf::from("/tmp/first.txt")]);
                assert_eq!(manifest.active_index(), Some(0));
            }
            other => panic!("expected a ready manifest, got {other:?}"),
        }
    }

    #[test]
    fn manifest_update_reports_write_failures_without_touching_document_state() {
        use crate::session_restore::SessionManifestStore;

        let dir = crate::document::test_support::TestDir::new();
        // 用普通文件占据父目录位置，使清单目录无法创建。
        std::fs::write(dir.join("blocker"), b"file").unwrap();
        let manifests = SessionManifestStore::at_path(dir.join("blocker/session.json"));
        let store = DocumentStore::default();
        let active = store.create_active(test_trusted("/tmp/kept.txt"));

        let result = update_open_files_manifest_inner(
            &store,
            &manifests,
            1,
            std::slice::from_ref(&active),
            Some(&active),
        );
        assert!(matches!(
            result,
            Err(ref error) if error.code == DocumentErrorCode::SessionManifestWriteFailed
        ));
        // 文档可信状态不受写入失败影响。
        assert!(store.active_for(&active).is_some());
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
    fn candidate_open_does_not_invalidate_other_document_grant() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/active.txt"));
        let grant = store
            .establish_save_grant(Some(id), dir.path().to_path_buf(), "target".to_owned())
            .unwrap();

        // 在另一个文档 id 上候选打开，不清除本文档 entry 的保存目录授权（跨文档落盘
        // 由 grant 归属保护）。
        store.store_open(
            "candidate".to_owned(),
            b"candidate".to_vec(),
            test_trusted("/tmp/candidate.txt"),
        );
        assert!(store.current_save_grant(&grant.id).is_some());
    }

    #[test]
    fn single_document_open_replacement_clears_unreachable_old_state_on_promotion() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let old_id = store.create_active(test_trusted("/tmp/old.txt"));
        store.record_conflict(&old_id, ConflictKind::ContentChanged, b"old edits".to_vec());
        let old_grant = store
            .establish_save_grant(
                Some(old_id.clone()),
                dir.path().to_path_buf(),
                "old".to_owned(),
            )
            .unwrap();
        let untitled_grant = store
            .establish_save_grant(None, dir.path().to_path_buf(), "untitled".to_owned())
            .unwrap();

        store.store_open_replacing_session(
            "new-doc".to_owned(),
            b"new content".to_vec(),
            test_trusted("/tmp/new.txt"),
        );

        // 候选未被前端取回前，旧单文档会话仍可继续保存/处理冲突。
        assert!(store.active_for(&old_id).is_some());
        assert!(store.conflict_for(&old_id).is_some());
        assert!(store.current_save_grant(&old_grant.id).is_some());

        assert_eq!(store.take_content("new-doc"), Some(b"new content".to_vec()));

        // 当前单文档打开入口完成提升后，旧 id 已不可达的后端状态必须被清掉。
        assert!(store.active_for(&old_id).is_none());
        assert!(store.conflict_for(&old_id).is_none());
        assert!(store.current_save_grant(&old_grant.id).is_none());
        assert!(store.current_save_grant(&untitled_grant.id).is_none());
        assert_eq!(
            store.active_for("new-doc").unwrap().path,
            PathBuf::from("/tmp/new.txt")
        );
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
            preview_target(dir.path(), "current.txt", Some(&trusted), None, &[]).unwrap(),
            TargetPreview {
                exists: true,
                is_current_path: true,
                occupied_tab_id: None,
            }
        );
        assert_eq!(
            preview_target(dir.path(), "other.txt", Some(&trusted), None, &[]).unwrap(),
            TargetPreview {
                exists: true,
                is_current_path: false,
                occupied_tab_id: None,
            }
        );
        assert_eq!(
            preview_target(dir.path(), "missing.txt", Some(&trusted), None, &[]).unwrap(),
            TargetPreview {
                exists: false,
                is_current_path: false,
                occupied_tab_id: None,
            }
        );
        assert_eq!(
            preview_target(dir.path(), "../escape.txt", Some(&trusted), None, &[]),
            Err(DocumentErrorCode::InvalidFileName)
        );
    }

    #[cfg(unix)]
    #[test]
    fn open_path_identity_matches_selected_symlink_to_existing_real_path() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let real = dir.join("real.txt");
        let link = dir.join("link.txt");
        std::fs::write(&real, b"content").unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();

        let known_documents = [KnownDocumentPath {
            tab_id: "tab-real".to_owned(),
            path: real,
        }];

        assert_eq!(
            known_document_for_path(&link, &known_documents),
            Some("tab-real".to_owned())
        );
    }

    #[test]
    fn preview_reports_target_occupied_by_another_tab() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let occupied = dir.join("occupied.txt");
        std::fs::write(&occupied, b"occupied").unwrap();

        let known_documents = [
            KnownDocumentPath {
                tab_id: "tab-current".to_owned(),
                path: dir.join("current.txt"),
            },
            KnownDocumentPath {
                tab_id: "tab-other".to_owned(),
                path: occupied,
            },
        ];

        assert_eq!(
            preview_target(
                dir.path(),
                "occupied.txt",
                None,
                Some("tab-current"),
                &known_documents,
            )
            .unwrap(),
            TargetPreview {
                exists: true,
                is_current_path: false,
                occupied_tab_id: Some("tab-other".to_owned()),
            }
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
    fn candidate_promotion_does_not_clear_other_document_conflict() {
        let store = DocumentStore::default();
        let active_id = store.create_active(test_trusted("/tmp/active.txt"));
        store.record_conflict(&active_id, ConflictKind::ContentChanged, b"snap".to_vec());

        let candidate_id = "candidate".to_owned();
        store.store_open(
            candidate_id.clone(),
            b"new content".to_vec(),
            test_trusted("/tmp/candidate.txt"),
        );
        // 候选打开与提升都只作用于候选自身的 entry，不清除其他文档的冲突。
        assert!(store.conflict_for(&active_id).is_some());

        assert_eq!(
            store.take_content(&candidate_id),
            Some(b"new content".to_vec())
        );
        assert!(store.conflict_for(&active_id).is_some());
    }

    #[test]
    fn create_active_does_not_clear_other_document_conflict() {
        let store = DocumentStore::default();
        let id = store.create_active(test_trusted("/tmp/x.txt"));
        store.record_conflict(&id, ConflictKind::ContentChanged, b"snap".to_vec());
        let _new = store.create_active(test_trusted("/tmp/y.txt"));
        // 多文档并发：新建另一个文档不影响本文档的冲突状态。
        assert!(store.conflict_for(&id).is_some());
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

    #[test]
    fn multiple_documents_coexist_as_active_independently() {
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        let b = store.create_active(test_trusted("/tmp/b.txt"));

        // 两个文档同时为活动状态，互不驱逐。
        let active_a = store.active_for(&a).unwrap();
        let active_b = store.active_for(&b).unwrap();
        assert_eq!(active_a.path, PathBuf::from("/tmp/a.txt"));
        assert_eq!(active_b.path, PathBuf::from("/tmp/b.txt"));
    }

    #[test]
    fn per_document_conflicts_are_independent() {
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        let b = store.create_active(test_trusted("/tmp/b.txt"));

        store.record_conflict(&a, ConflictKind::ContentChanged, b"a-snap".to_vec());
        assert!(store.conflict_for(&a).is_some());
        assert!(store.conflict_for(&b).is_none());

        store.record_conflict(&b, ConflictKind::ContentChanged, b"b-snap".to_vec());
        assert!(store.conflict_for(&a).is_some());
        assert!(store.conflict_for(&b).is_some());

        // 取消 a 的冲突不影响 b。
        assert!(store.clear_content_conflict(&a));
        assert!(store.conflict_for(&a).is_none());
        assert!(store.conflict_for(&b).is_some());
    }

    #[test]
    fn per_document_overwrite_leases_do_not_block_other_documents() {
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        let b = store.create_active(test_trusted("/tmp/b.txt"));
        store.record_conflict(&a, ConflictKind::ContentChanged, b"a".to_vec());
        store.record_conflict(&b, ConflictKind::ContentChanged, b"b".to_vec());

        // a 的覆盖租约只门控 a：a 的 active_for 被阻塞，b 仍可访问并可独立取得租约。
        let lease_a = store.begin_overwrite(&a).unwrap();
        assert!(store.active_for(&a).is_none());
        assert!(store.active_for(&b).is_some());
        let lease_b = store.begin_overwrite(&b).unwrap();
        assert_eq!(lease_b.snapshot, b"b");

        // 提交 a 只清 a 的冲突，不影响 b 的租约/冲突。
        let fp = FileFingerprint::of(b"a");
        assert!(
            store
                .commit_overwrite(&a, lease_a.revision, fp, 1)
                .is_some()
        );
        assert!(store.conflict_for(&a).is_none());
        assert!(store.conflict_for(&b).is_some());
        assert!(store.abort_overwrite(&b, lease_b.revision));
    }

    #[test]
    fn per_document_conflict_revisions_remain_unique_and_monotone() {
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        let b = store.create_active(test_trusted("/tmp/b.txt"));

        store.record_conflict(&a, ConflictKind::ContentChanged, b"a1".to_vec());
        let r1 = store.conflict_for(&a).unwrap().revision;
        store.record_conflict(&b, ConflictKind::ContentChanged, b"b1".to_vec());
        let r2 = store.conflict_for(&b).unwrap().revision;
        assert!(store.clear_content_conflict(&a));
        store.record_conflict(&a, ConflictKind::ContentChanged, b"a2".to_vec());
        let r3 = store.conflict_for(&a).unwrap().revision;

        assert!(
            r1 < r2 && r2 < r3,
            "revisions must be globally monotone across documents"
        );
    }

    #[test]
    fn per_document_save_grants_coexist_and_are_scoped() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        let b = store.create_active(test_trusted("/tmp/b.txt"));
        let grant_a = store
            .establish_save_grant(Some(a.clone()), dir.path().to_path_buf(), "a".to_owned())
            .unwrap();
        let grant_b = store
            .establish_save_grant(Some(b.clone()), dir.path().to_path_buf(), "b".to_owned())
            .unwrap();

        // 两个授权按各自 grant id 共存且只归属自身文档。
        let stored_a = store.current_save_grant(&grant_a.id).unwrap();
        let stored_b = store.current_save_grant(&grant_b.id).unwrap();
        assert!(grant_matches_document(&stored_a, Some(&a)));
        assert!(!grant_matches_document(&stored_a, Some(&b)));
        assert!(grant_matches_document(&stored_b, Some(&b)));

        // 关闭 a 只清 a 的授权，b 的保留。
        assert!(store.close_active(&a));
        assert!(store.current_save_grant(&grant_a.id).is_none());
        assert!(store.current_save_grant(&grant_b.id).is_some());
    }

    #[test]
    fn candidate_open_on_one_document_does_not_disturb_another() {
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        store.record_conflict(&a, ConflictKind::ContentChanged, b"a".to_vec());

        // 在另一个 id 上候选打开：a 的活动状态与冲突都不受影响。
        store.store_open(
            "candidate".to_owned(),
            b"c".to_vec(),
            test_trusted("/tmp/candidate.txt"),
        );
        assert!(store.active_for(&a).is_some());
        assert!(store.conflict_for(&a).is_some());
    }

    #[test]
    fn take_content_promotes_only_the_requesting_document() {
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));

        store.store_open(
            "b".to_owned(),
            b"b-content".to_vec(),
            test_trusted("/tmp/b.txt"),
        );
        // 提升 b 不影响 a 的可信路径。
        assert_eq!(store.take_content("b"), Some(b"b-content".to_vec()));
        let active_a = store.active_for(&a).unwrap();
        assert_eq!(active_a.path, PathBuf::from("/tmp/a.txt"));
        let active_b = store.active_for("b").unwrap();
        assert_eq!(active_b.path, PathBuf::from("/tmp/b.txt"));
    }

    #[test]
    fn reload_candidate_on_one_document_preserves_other() {
        let store = DocumentStore::default();
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        let b = store.create_active(test_trusted("/tmp/b.txt"));
        store.record_conflict(&a, ConflictKind::ContentChanged, b"a".to_vec());
        store.record_conflict(&b, ConflictKind::ContentChanged, b"b".to_vec());
        let rev_a = store.conflict_for(&a).unwrap().revision;

        // 在 a 上准备重载候选：b 的冲突保留。
        assert!(store.prepare_reload(
            &a,
            rev_a,
            b"a-reloaded".to_vec(),
            test_trusted("/tmp/a.txt")
        ));
        assert!(store.conflict_for(&b).is_some());

        // 取回 a 的重载只清 a 的冲突，b 的冲突保留。
        assert_eq!(store.take_content(&a), Some(b"a-reloaded".to_vec()));
        assert!(store.conflict_for(&a).is_none());
        assert!(store.conflict_for(&b).is_some());
    }

    #[test]
    fn untitled_grant_coexists_with_file_document_grants() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        // 文件文档先 active，Untitled 授权仍可发放——多标签下 Untitled 标签可与文件标签共存，
        // 不再要求后端没有任何活动文档。二者落入不同槽位、grant id 不同。
        let a = store.create_active(test_trusted("/tmp/a.txt"));
        let file_grant = store
            .establish_save_grant(Some(a), dir.path().to_path_buf(), "file".to_owned())
            .unwrap();
        let untitled_grant = store
            .establish_save_grant(None, dir.path().to_path_buf(), "untitled".to_owned())
            .unwrap();

        assert_ne!(untitled_grant.id, file_grant.id);
        assert!(store.current_save_grant(&untitled_grant.id).is_some());
        assert!(store.current_save_grant(&file_grant.id).is_some());

        // 消费其一不影响另一个。
        store.take_save_grant(&file_grant.id);
        assert!(store.current_save_grant(&file_grant.id).is_none());
        assert!(store.current_save_grant(&untitled_grant.id).is_some());
    }

    #[test]
    fn untitled_first_save_succeeds_with_active_file_document() {
        use crate::document::test_support::TestDir;

        let dir = TestDir::new();
        let store = DocumentStore::default();
        // 已有一个 active 文件文档。
        let file_id = store.create_active(test_trusted("/tmp/notes.md"));

        // 文件文档仍 active 时，对 Untitled 发放保存目录授权（不再因其他 entry active 而拒绝）。
        let untitled_grant = store
            .establish_save_grant(None, dir.path().to_path_buf(), "untitled-target".to_owned())
            .unwrap();

        // 保存目标解析按 grant.document_id == None 归属成立；路径为授权目录 + 校验过的文件名，
        // 不会扩大为任意路径写入。
        let (target_path, trusted_opt) =
            resolve_save_target(&store, None, &untitled_grant.id, "saved.txt").unwrap();
        assert_eq!(target_path, dir.path().join("saved.txt"));
        assert!(trusted_opt.is_none());

        // 预览目标不写盘。
        assert_eq!(
            preview_target(dir.path(), "saved.txt", None, None, &[]).unwrap(),
            TargetPreview {
                exists: false,
                is_current_path: false,
                occupied_tab_id: None,
            }
        );

        // 首次保存成功落盘。
        let descriptor = tauri::async_runtime::block_on(save_document_as_at_inner(
            &store,
            None,
            &untitled_grant.id,
            "saved.txt",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
            "untitled content".to_owned(),
        ))
        .unwrap();
        assert_eq!(
            std::fs::read(dir.join("saved.txt")).unwrap(),
            b"untitled content"
        );
        assert_eq!(descriptor.display_name, "saved.txt");

        // 文件文档仍 active，Untitled 首次保存建立了自己的可信关联，二者并发共存。
        assert!(store.active_for(&file_id).is_some());
        assert!(store.active_for(&descriptor.id).is_some());

        // Untitled 授权被单次消费。
        assert!(store.current_save_grant(&untitled_grant.id).is_none());
    }

    #[test]
    fn single_document_degeneration_matches_current_behavior() {
        // 单一文档 id 贯穿全流程，与重构前的单文档行为一致。
        let store = DocumentStore::default();
        store.store_open(
            "doc".to_owned(),
            b"hello".to_vec(),
            test_trusted("/tmp/doc.txt"),
        );
        assert!(store.active_for("doc").is_none());
        assert_eq!(store.take_content("doc"), Some(b"hello".to_vec()));
        assert!(store.take_content("doc").is_none());
        assert!(store.active_for("doc").is_some());

        store.record_conflict("doc", ConflictKind::ContentChanged, b"edits".to_vec());
        let revision = store.conflict_for("doc").unwrap().revision;
        assert!(store.prepare_reload(
            "doc",
            revision,
            b"disk".to_vec(),
            test_trusted("/tmp/doc.txt")
        ));
        assert_eq!(store.take_content("doc"), Some(b"disk".to_vec()));
        assert!(store.conflict_for("doc").is_none());

        // 覆盖租约与关闭仍按单文档语义工作。
        store.record_conflict("doc", ConflictKind::ContentChanged, b"again".to_vec());
        let lease = store.begin_overwrite("doc").unwrap();
        let fp = FileFingerprint::of(b"again");
        let updated = store
            .commit_overwrite("doc", lease.revision, fp.clone(), 5)
            .unwrap();
        assert_eq!(updated.fingerprint, fp);
        assert!(store.close_active("doc"));
        assert!(store.active_for("doc").is_none());
    }

    // ---- 外部文件变化分类契约（external-file-change-sync 切片 2）----

    mod external_change {
        use super::*;
        use crate::document::test_support::TestDir;
        use std::os::unix::fs::PermissionsExt;

        fn create_active_from_file(store: &DocumentStore, path: PathBuf, bytes: &[u8]) -> String {
            std::fs::write(&path, bytes).unwrap();
            let snapshot = crate::document::analyze(bytes).unwrap();
            let display_name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let trusted = TrustedDocument {
                path,
                display_name,
                encoding: snapshot.encoding,
                line_ending: snapshot.line_ending,
                fingerprint: snapshot.fingerprint,
                byte_count: snapshot.byte_count,
                read_only: false,
            };
            store.create_active(trusted)
        }

        #[test]
        fn unchanged_when_disk_matches_baseline() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("notes.txt");
            let id = create_active_from_file(&store, path.clone(), b"hello\n");
            let baseline = store.active_for(&id).unwrap().fingerprint;

            let change = store.classify_external_change(&id).unwrap();
            assert!(matches!(change, ExternalChange::Unchanged));
            assert!(!store.has_pending_external_reload(&id));
            assert_eq!(store.active_for(&id).unwrap().fingerprint, baseline);
        }

        #[test]
        fn content_changed_stores_candidate_without_replacing_active() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("notes.txt");
            let id = create_active_from_file(&store, path.clone(), b"hello\n");
            let baseline = store.active_for(&id).unwrap().fingerprint;

            std::fs::write(&path, b"hello world\nmore\n").unwrap();

            let change = store.classify_external_change(&id).unwrap();
            assert!(matches!(change, ExternalChange::ContentChanged));
            assert_eq!(store.active_for(&id).unwrap().fingerprint, baseline);
            assert!(store.has_pending_external_reload(&id));
        }

        #[test]
        fn external_candidate_becomes_versioned_conflict_with_local_snapshot() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("dirty-conflict.txt");
            let id = create_active_from_file(&store, path.clone(), b"disk v1\n");
            let baseline = store.active_for(&id).unwrap().fingerprint;
            std::fs::write(&path, b"disk v2\n").unwrap();

            store.classify_external_change(&id).unwrap();
            assert!(store.record_external_conflict(&id, b"local edits\n".to_vec()));

            let conflict = store.content_conflict_for(&id).unwrap();
            assert_eq!(conflict.snapshot, b"local edits\n");
            assert_eq!(conflict.trusted.fingerprint, baseline);
            assert_eq!(store.active_for(&id).unwrap().fingerprint, baseline);
            assert!(!store.has_pending_external_reload(&id));
            assert!(store.classify_external_change(&id).is_none());
        }

        #[test]
        fn repeated_external_conflict_request_is_idempotent() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("dirty-repeat.txt");
            let id = create_active_from_file(&store, path.clone(), b"disk v1\n");
            std::fs::write(&path, b"disk v2\n").unwrap();
            store.classify_external_change(&id).unwrap();

            assert!(store.record_external_conflict(&id, b"first snapshot\n".to_vec()));
            let first = store.content_conflict_for(&id).unwrap();
            assert!(store.record_external_conflict(&id, b"later duplicate\n".to_vec()));
            let repeated = store.content_conflict_for(&id).unwrap();

            assert_eq!(repeated.revision, first.revision);
            assert_eq!(repeated.snapshot, b"first snapshot\n");
        }

        #[test]
        fn external_conflict_rejects_candidate_after_disk_changes_again() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("dirty-stale.txt");
            let id = create_active_from_file(&store, path.clone(), b"disk v1\n");
            std::fs::write(&path, b"disk v2\n").unwrap();
            store.classify_external_change(&id).unwrap();
            std::fs::write(&path, b"disk v3\n").unwrap();

            assert!(!store.record_external_conflict(&id, b"local edits\n".to_vec()));
            assert!(store.content_conflict_for(&id).is_none());
            assert!(!store.has_pending_external_reload(&id));
        }

        #[test]
        fn byte_change_with_same_text_still_content_changed() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("bom.txt");
            // 基线：无 BOM 的 "a"。
            let id = create_active_from_file(&store, path.clone(), b"a");
            // 磁盘改为带 BOM 的 "a"：解码文本相同但字节/指纹变化。
            std::fs::write(&path, [0xEF, 0xBB, 0xBF, b'a']).unwrap();

            let change = store.classify_external_change(&id).unwrap();
            assert!(matches!(change, ExternalChange::ContentChanged));
        }

        #[test]
        fn metadata_only_readonly_change() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("readonly.txt");
            let id = create_active_from_file(&store, path.clone(), b"same\n");
            assert!(!store.active_for(&id).unwrap().read_only);

            let metadata = std::fs::metadata(&path).unwrap();
            let mut perms = metadata.permissions();
            perms.set_mode(0o444);
            std::fs::set_permissions(&path, perms).unwrap();

            let change = store.classify_external_change(&id).unwrap();
            assert!(matches!(change, ExternalChange::MetadataChanged));
            // 仅元数据变化：活动状态未推进，候选挂起。
            assert!(!store.active_for(&id).unwrap().read_only);
            assert!(store.has_pending_external_reload(&id));
        }

        #[test]
        fn reports_missing_without_candidate() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("gone.txt");
            let id = create_active_from_file(&store, path.clone(), b"data\n");
            let baseline = store.active_for(&id).unwrap().fingerprint;

            std::fs::remove_file(&path).unwrap();

            let change = store.classify_external_change(&id).unwrap();
            assert!(matches!(change, ExternalChange::Missing));
            assert!(!store.has_pending_external_reload(&id));
            assert_eq!(store.active_for(&id).unwrap().fingerprint, baseline);
        }

        #[test]
        fn reports_reload_failure_for_invalid_encoding() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("invalid.txt");
            let id = create_active_from_file(&store, path.clone(), b"ok\n");
            let baseline = store.active_for(&id).unwrap().fingerprint;

            std::fs::write(&path, [0xFF]).unwrap();

            let change = store.classify_external_change(&id).unwrap();
            assert!(matches!(
                change,
                ExternalChange::ReloadFailed(DocumentError::InvalidEncoding)
            ));
            assert!(!store.has_pending_external_reload(&id));
            assert_eq!(store.active_for(&id).unwrap().fingerprint, baseline);
        }

        #[test]
        fn retry_external_reload_preserves_stable_failure_error() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("retry-invalid.txt");
            let id = create_active_from_file(&store, path.clone(), b"ok\n");
            std::fs::write(&path, [0xFF]).unwrap();

            let retry = store.retry_external_reload(&id).unwrap();
            match retry {
                ExternalReloadRetry::Failed { error } => {
                    assert_eq!(error.code, DocumentErrorCode::UnsupportedEncoding);
                }
                other => panic!("expected failed retry, got {other:?}"),
            }
            assert!(!store.has_pending_external_reload(&id));
        }

        #[test]
        fn retry_external_reload_adopts_fixed_content() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("retry-fixed.txt");
            let id = create_active_from_file(&store, path.clone(), b"v1\n");
            std::fs::write(&path, b"v2\n").unwrap();

            let retry = store.retry_external_reload(&id).unwrap();
            match retry {
                ExternalReloadRetry::Ready {
                    reload: ExternalReloadReady::Content { descriptor },
                } => {
                    assert_eq!(descriptor.id, id);
                }
                other => panic!("expected content retry, got {other:?}"),
            }
            assert_eq!(store.take_content(&id), Some(b"v2\n".to_vec()));
        }

        #[test]
        fn returns_none_for_unknown_id() {
            let store = DocumentStore::default();
            assert!(store.classify_external_change("stale-doc").is_none());
            assert!(store.take_external_reload("stale-doc").is_none());
        }

        #[test]
        fn classify_isolates_documents() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path_a = dir.join("a.txt");
            let path_b = dir.join("b.txt");
            let id_a = create_active_from_file(&store, path_a.clone(), b"a\n");
            let id_b = create_active_from_file(&store, path_b.clone(), b"b\n");

            std::fs::write(&path_a, b"a changed\n").unwrap();
            let change = store.classify_external_change(&id_a).unwrap();
            assert!(matches!(change, ExternalChange::ContentChanged));

            assert!(store.has_pending_external_reload(&id_a));
            assert!(!store.has_pending_external_reload(&id_b));
        }

        #[test]
        fn take_promotes_content_atomically() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("promote.txt");
            let id = create_active_from_file(&store, path.clone(), b"one\n");
            let new_bytes = b"two\nlines\n";
            std::fs::write(&path, new_bytes).unwrap();
            let new_fp = FileFingerprint::of(new_bytes);

            store.classify_external_change(&id).unwrap();
            let reload = store.take_external_reload(&id).unwrap();
            let expected = crate::document::analyze(new_bytes).unwrap();
            match reload {
                ExternalReload::Content {
                    descriptor,
                    content,
                } => {
                    assert_eq!(descriptor.fingerprint, new_fp);
                    assert_eq!(descriptor.byte_count, new_bytes.len() as u64);
                    assert_eq!(content, expected.content);
                }
                other => panic!("expected content reload, got {other:?}"),
            }
            assert_eq!(store.active_for(&id).unwrap().fingerprint, new_fp);
            assert!(!store.has_pending_external_reload(&id));
            assert!(store.take_external_reload(&id).is_none());
        }

        #[test]
        fn prepare_keeps_old_baseline_until_binary_content_is_taken() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("binary-promotion.txt");
            let id = create_active_from_file(&store, path.clone(), b"old\n");
            let baseline = store.active_for(&id).unwrap().fingerprint;
            std::fs::write(&path, b"new\n").unwrap();
            let changed = FileFingerprint::of(b"new\n");

            store.classify_external_change(&id).unwrap();
            let ready = store.prepare_external_reload(&id).unwrap();
            assert!(matches!(ready, ExternalReloadReady::Content { .. }));
            assert_eq!(store.active_for(&id).unwrap().fingerprint, baseline);
            assert!(store.begin_external_check(&id).is_none());

            assert_eq!(store.take_content(&id).unwrap(), b"new\n");
            assert_eq!(store.active_for(&id).unwrap().fingerprint, changed);
        }

        #[test]
        fn take_promotes_metadata_change() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("meta.txt");
            let id = create_active_from_file(&store, path.clone(), b"same\n");
            let metadata = std::fs::metadata(&path).unwrap();
            let mut perms = metadata.permissions();
            perms.set_mode(0o444);
            std::fs::set_permissions(&path, perms).unwrap();

            store.classify_external_change(&id).unwrap();
            let reload = store.take_external_reload(&id).unwrap();
            match reload {
                ExternalReload::Metadata { descriptor } => {
                    assert!(descriptor.read_only);
                }
                other => panic!("expected metadata reload, got {other:?}"),
            }
            assert!(store.active_for(&id).unwrap().read_only);
            assert!(!store.has_pending_external_reload(&id));
        }

        #[test]
        fn take_returns_none_when_baseline_changed() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("stale.txt");
            let id = create_active_from_file(&store, path.clone(), b"v1\n");
            std::fs::write(&path, b"v2\n").unwrap();

            store.classify_external_change(&id).unwrap();
            // 模拟用户在候选挂起期间保存：活动指纹推进，候选基线过期。
            let saved_fp = FileFingerprint::of(b"user saved\n");
            store.update_active(&id, saved_fp.clone(), 11);

            assert!(store.take_external_reload(&id).is_none());
            assert_eq!(store.active_for(&id).unwrap().fingerprint, saved_fp);
            assert!(!store.has_pending_external_reload(&id));
        }

        #[test]
        fn later_non_candidate_results_clear_an_older_candidate() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("candidate-lifecycle.txt");
            let id = create_active_from_file(&store, path.clone(), b"v1\n");

            std::fs::write(&path, b"v2\n").unwrap();
            assert!(matches!(
                store.classify_external_change(&id),
                Some(ExternalChange::ContentChanged)
            ));
            assert!(store.has_pending_external_reload(&id));

            std::fs::write(&path, b"v1\n").unwrap();
            assert!(matches!(
                store.classify_external_change(&id),
                Some(ExternalChange::Unchanged)
            ));
            assert!(!store.has_pending_external_reload(&id));
            assert!(store.take_external_reload(&id).is_none());

            std::fs::write(&path, b"v2\n").unwrap();
            store.classify_external_change(&id).unwrap();
            std::fs::remove_file(&path).unwrap();
            assert!(matches!(
                store.classify_external_change(&id),
                Some(ExternalChange::Missing)
            ));
            assert!(!store.has_pending_external_reload(&id));

            std::fs::write(&path, b"v2\n").unwrap();
            store.classify_external_change(&id).unwrap();
            std::fs::write(&path, [0xFF]).unwrap();
            assert!(matches!(
                store.classify_external_change(&id),
                Some(ExternalChange::ReloadFailed(DocumentError::InvalidEncoding))
            ));
            assert!(!store.has_pending_external_reload(&id));
        }

        #[test]
        fn conflict_invalidates_candidate_and_blocks_promotion() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("conflict.txt");
            let id = create_active_from_file(&store, path.clone(), b"disk v1\n");

            std::fs::write(&path, b"disk v2\n").unwrap();
            store.classify_external_change(&id).unwrap();
            assert!(store.has_pending_external_reload(&id));

            store.record_conflict(
                &id,
                ConflictKind::ContentChanged,
                b"unsaved local edits\n".to_vec(),
            );

            assert!(!store.has_pending_external_reload(&id));
            assert!(store.take_external_reload(&id).is_none());
            assert!(store.content_conflict_for(&id).is_some());
        }

        #[test]
        fn promotion_rejects_candidate_when_disk_changes_again() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("changed-again.txt");
            let id = create_active_from_file(&store, path.clone(), b"v1\n");
            let baseline = store.active_for(&id).unwrap().fingerprint;

            std::fs::write(&path, b"v2\n").unwrap();
            store.classify_external_change(&id).unwrap();
            std::fs::write(&path, b"v3\n").unwrap();

            assert!(store.take_external_reload(&id).is_none());
            assert!(!store.has_pending_external_reload(&id));
            assert_eq!(store.active_for(&id).unwrap().fingerprint, baseline);
        }

        #[test]
        fn older_check_cannot_overwrite_a_newer_candidate() {
            let dir = TestDir::new();
            let store = DocumentStore::default();
            let path = dir.join("out-of-order.txt");
            let id = create_active_from_file(&store, path.clone(), b"v1\n");

            let older = store.begin_external_check(&id).unwrap();
            std::fs::write(&path, b"v2\n").unwrap();
            let older_observation = document::open_document(&path);

            let newer = store.begin_external_check(&id).unwrap();
            std::fs::write(&path, b"v3\n").unwrap();
            let newer_observation = document::open_document(&path);

            assert!(matches!(
                store.finish_external_check(&id, newer, newer_observation),
                Some(ExternalChange::ContentChanged)
            ));
            assert!(
                store
                    .finish_external_check(&id, older, older_observation)
                    .is_none()
            );

            match store.take_external_reload(&id).unwrap() {
                ExternalReload::Content { content, .. } => assert_eq!(content, "v3\n"),
                other => panic!("expected latest content reload, got {other:?}"),
            }
        }
    }
}
