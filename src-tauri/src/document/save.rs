//! Rust 文档编码与安全保存核心。
//!
//! 给定路径、打开时指纹、目标编码、目标换行和 Unicode 文本，要么完整保存并返回新的
//! 文档身份，要么明确失败且不破坏原文件。本模块是内部 Rust 能力，不暴露为 Tauri 命令。

use std::fs::{File, OpenOptions, Permissions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::document::error::DocumentError;
use crate::document::{
    FileFingerprint, LineEnding, MAX_FILE_SIZE_BYTES, TextEncoding, check_size, encoding,
    line_ending, read_bounded,
};

/// 保存目标的语义。核心据此区分普通保存与另存为，并决定是否校验源只读。
pub enum SaveTarget {
    /// 普通保存：目标即源路径。核心按 `source_read_only` 拒绝只读源（遵守
    /// `safe-save-core` 不变量「只读描述符必须拒绝普通保存」）；目标须存在且匹配 `expected`。
    InPlace {
        source_read_only: bool,
        expected: FileFingerprint,
    },
    /// 另存为到对话框返回后首次观测到的**已存在**目标。不校验源只读；目标须匹配 `observed`，
    /// 保留目标权限并原子替换。`observed` 是后端在对话框返回后首次读到的目标指纹。
    ExistingTarget { observed: FileFingerprint },
    /// 首次保存或另存到首次观测时**不存在**的目标。不校验源只读；以临时文件 + 同步 +
    /// 原子不覆盖提交（`hard_link`）创建，OS 默认权限。
    NewTarget,
}

/// 保存请求。`content` 持有完整 Unicode 文本；`target` 决定落盘语义与源只读校验。
pub struct SaveRequest {
    pub content: String,
    pub encoding: TextEncoding,
    /// 保存目标换行；`Mixed` 表示调用方未解析，核心会拒绝。
    pub line_ending: LineEnding,
    pub target: SaveTarget,
}

/// 保存成功后基于最终写入字节重新计算的身份。
#[derive(Debug, Clone, PartialEq)]
pub struct SaveOutcome {
    pub byte_count: u64,
    pub fingerprint: FileFingerprint,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
}

static NEXT_TEMP_TAG: AtomicU64 = AtomicU64::new(1);

/// 安全保存文档。
///
/// 按 `SaveTarget` 分派：`InPlace`/`ExistingTarget` 走「解析目标 → 编码/大小限制 → 指纹
/// 冲突检测 → 只读/权限捕获 → 同目录原子替换（替换前 best-effort 再校验）」；`NewTarget`
/// 走「解析父目录 → 编码/大小限制 → 同目录临时文件写入同步 → 原子不覆盖提交」。源只读
/// 校验仅在 `InPlace` 由核心执行。任一步失败都保留原文件。
pub fn save_document(path: &Path, request: SaveRequest) -> Result<SaveOutcome, DocumentError> {
    save_document_with_before_replace(path, request, || {})
}

/// 与 [`save_document`] 相同，额外提供 `before_replace` 缝：在临时文件完成写入与同步
/// 之后、最终原子提交之前调用。测试用它确定性地模拟「观测与提交之间外部修改」。
pub(crate) fn save_document_with_before_replace<F>(
    path: &Path,
    request: SaveRequest,
    before_replace: F,
) -> Result<SaveOutcome, DocumentError>
where
    F: FnOnce(),
{
    // 源只读校验保留在核心，且仅对普通保存（目标即源）生效；另存为不阻止只读源。
    if let SaveTarget::InPlace {
        source_read_only, ..
    } = &request.target
    {
        if *source_read_only {
            return Err(DocumentError::ReadOnly);
        }
    }

    let normalized = line_ending::normalize(&request.content, request.line_ending)?;
    let bytes = encoding::encode(&normalized, request.encoding)?;
    check_size(bytes.len() as u64)?;

    match &request.target {
        SaveTarget::InPlace { expected, .. }
        | SaveTarget::ExistingTarget { observed: expected } => {
            // 解析符号链接到真实目标：读取/校验本就跟随链接，rename 作用于真实目标可保留链接。
            let target = resolve_save_target(path)?;
            verify_no_conflict(&target, expected)?;
            // 初次只读快检：明显只读时直接失败；最终权限以替换前重读为准。
            capture_writable_permissions(&target)?;
            atomic_write_with_recheck(&target, &bytes, expected, before_replace)?;
        }
        SaveTarget::NewTarget => {
            // 目标尚不存在：解析父目录（跟随其中的符号链接），临时文件与提交均作用于真实父目录。
            let (resolved_parent, resolved_target) = resolve_new_target(path)?;
            atomic_create_with_recheck(&resolved_parent, &resolved_target, &bytes, before_replace)?;
        }
    }

    Ok(SaveOutcome {
        byte_count: bytes.len() as u64,
        fingerprint: FileFingerprint::of(&bytes),
        encoding: request.encoding,
        line_ending: request.line_ending,
    })
}

/// 把保存目标解析为真实路径（跟随符号链接），使后续校验与原子替换作用于链接指向的
/// 真实文件，而非链接目录项。目标缺失视为冲突。
fn resolve_save_target(path: &Path) -> Result<PathBuf, DocumentError> {
    match std::fs::canonicalize(path) {
        Ok(resolved) => Ok(resolved),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Err(DocumentError::SaveConflict),
        Err(err) => Err(DocumentError::Io(err)),
    }
}

/// 解析「尚不存在」的目标：canonicalize 父目录（跟随其中的符号链接），再拼回文件名。
/// 父目录缺失视为冲突。返回 (解析后的父目录, 解析后的目标路径)，二者同卷以便原子提交。
fn resolve_new_target(path: &Path) -> Result<(PathBuf, PathBuf), DocumentError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let resolved_parent = match std::fs::canonicalize(parent) {
        Ok(resolved) => resolved,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(DocumentError::SaveConflict);
        }
        Err(err) => return Err(DocumentError::Io(err)),
    };
    let file_name = path.file_name().ok_or_else(|| {
        DocumentError::Io(std::io::Error::other(
            "save target has no file name component",
        ))
    })?;
    let resolved_target = resolved_parent.join(file_name);
    Ok((resolved_parent, resolved_target))
}

/// 写入前确认磁盘目标仍与打开时指纹一致。
///
/// - 文件缺失或大小变化视为冲突。
/// - 大小相同时按 SHA-256 核对；内容完全一致（即使文件身份被原子替换）不视为冲突。
fn verify_no_conflict(path: &Path, original: &FileFingerprint) -> Result<(), DocumentError> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(DocumentError::SaveConflict);
        }
        Err(err) => return Err(DocumentError::Io(err)),
    };

    if metadata.len() != original.size_bytes {
        return Err(DocumentError::SaveConflict);
    }

    let mut file = File::open(path)?;
    let bytes = match read_bounded(&mut file, metadata.len(), MAX_FILE_SIZE_BYTES) {
        Ok(bytes) => bytes,
        // 读取期间文件被放大到超限，等价于不再是原文件，按冲突处理。
        Err(DocumentError::SizeLimitExceeded { .. }) => return Err(DocumentError::SaveConflict),
        Err(err) => return Err(err),
    };

    if FileFingerprint::of(&bytes).sha256 != original.sha256 {
        return Err(DocumentError::SaveConflict);
    }
    Ok(())
}

/// 重新检查目标当前是否只读，并捕获其权限以便应用到临时文件。
///
/// 只读判定不依赖打开时描述符（可能已陈旧）：当前磁盘权限只读即拒绝，防止原子替换
/// （目录操作）绕过只读文件。文件此时缺失视为冲突。
fn capture_writable_permissions(path: &Path) -> Result<Permissions, DocumentError> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(DocumentError::SaveConflict);
        }
        Err(err) => return Err(DocumentError::Io(err)),
    };
    let permissions = metadata.permissions();
    if permissions.readonly() {
        return Err(DocumentError::ReadOnly);
    }
    Ok(permissions)
}

/// 在目标所在目录写入临时文件，完整落盘后原子替换目标。
///
/// 步骤：`create_new` 建临时文件 → 写入并 `sync_all` → 关闭句柄 →（测试缝）→
/// best-effort 再次 `verify_no_conflict` → 重新读取只读与权限并应用到临时文件 →
/// `fs::rename` 原子替换。
///
/// - 临时文件名称带进程与单调标签，避免与目标或既有用户文件冲突。
/// - 写入、刷新、再次校验、改权限或替换任一步失败都清理临时文件，原文件保持不变。
///
/// 冲突检测与只读/权限保护都是 **best-effort**：再次校验、权限设置与 `rename` 之间
/// 仍存在狭窄的 TOCTOU 窗口——目标可能在最终只读检查通过后、`rename` 之前变为只读
/// 而被覆盖（原子 rename 是目录操作，Unix 上不要求目标可写）。跨平台没有通用的
/// 「按版本/身份/权限原子替换」原语（强制文件锁不可移植且对非协作进程无效）。本核心
/// 尽量缩小窗口并尽量保留原权限，但不声称内容冲突、只读或权限保护已严格关闭。
fn atomic_write_with_recheck<F>(
    path: &Path,
    bytes: &[u8],
    original: &FileFingerprint,
    before_replace: F,
) -> Result<(), DocumentError>
where
    F: FnOnce(),
{
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let (temp_path, file) = create_temp_exclusive(parent, path)?;

    let outcome = finish_atomic_write(file, &temp_path, path, bytes, original, before_replace);
    if outcome.is_err() {
        // 成功路径下临时文件已被 rename 消费；仅在失败时清理。
        let _ = std::fs::remove_file(&temp_path);
    }
    outcome
}

fn finish_atomic_write<F>(
    mut file: File,
    temp_path: &Path,
    target: &Path,
    bytes: &[u8],
    original: &FileFingerprint,
    before_replace: F,
) -> Result<(), DocumentError>
where
    F: FnOnce(),
{
    write_and_sync(&mut file, bytes)?;
    // 关闭句柄后再校验/改权限/替换：Windows 不允许重命名正被本进程打开的文件。
    drop(file);
    before_replace();
    // best-effort：尽可能晚地再次校验冲突，缩小覆盖外部修改的窗口。
    verify_no_conflict(target, original)?;
    // 最终替换前重新读取只读与权限：若保存期间目标被改为只读（即便内容未变）必须拒绝，
    // 并以当前权限（而非陈旧权限）应用到临时文件，避免覆盖后恢复旧的可写权限。
    let final_permissions = capture_writable_permissions(target)?;
    std::fs::set_permissions(temp_path, final_permissions)?;
    std::fs::rename(temp_path, target)?;
    Ok(())
}

fn create_temp_exclusive(parent: &Path, target: &Path) -> Result<(PathBuf, File), DocumentError> {
    loop {
        let temp_path = make_temp_path(parent, target);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(DocumentError::Io(err)),
        }
    }
}

fn write_and_sync(file: &mut File, bytes: &[u8]) -> Result<(), DocumentError> {
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn make_temp_path(parent: &Path, target: &Path) -> PathBuf {
    let stem = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".to_owned());
    let tag = NEXT_TEMP_TAG.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    parent.join(format!(".{stem}.textora-save.{pid}.{tag}.tmp"))
}

/// 创建一个尚不存在的目标：先在同目录写临时文件并 `sync_all`，再以**原子且不覆盖**的
/// `hard_link(temp, target)` 提交。
///
/// - 不直接对目标 `create_new`：写入/同步/进程异常会在目标路径留下部分文件，按路径清理
///   还可能误删竞争产生的新文件；这里异常仅留下带唯一名称的临时文件，并按其名称清理。
/// - `hard_link` 在目标已存在时失败（Unix `EEXIST` / Windows `ERROR_FILE_EXISTS`），从而
///   既原子又绝不覆盖「观测后出现」的新文件，失败返回 `SaveConflict`。
/// - `before_replace` 缝在临时文件写入同步后、`hard_link` 前调用，测试据此模拟「目标在
///   首次观测后被其他进程创建」。
fn atomic_create_with_recheck<F>(
    parent: &Path,
    target: &Path,
    bytes: &[u8],
    before_replace: F,
) -> Result<(), DocumentError>
where
    F: FnOnce(),
{
    let (temp_path, file) = create_temp_exclusive(parent, target)?;

    let outcome = finish_atomic_create(file, &temp_path, target, bytes, before_replace);
    if outcome.is_err() {
        // 成功路径下临时文件已通过 hard_link 消费（再 remove 其目录项，inode 由 target 保持）；
        // 仅在失败时清理临时文件本身。
        let _ = std::fs::remove_file(&temp_path);
    }
    outcome
}

fn finish_atomic_create<F>(
    mut file: File,
    temp_path: &Path,
    target: &Path,
    bytes: &[u8],
    before_replace: F,
) -> Result<(), DocumentError>
where
    F: FnOnce(),
{
    write_and_sync(&mut file, bytes)?;
    // 关闭句柄后再提交：Windows 不允许对正被本进程打开的文件建立硬链接或重命名。
    drop(file);
    before_replace();
    // 原子且不覆盖提交：目标已存在（观测后被创建）即失败为 SaveConflict，绝不覆盖。
    match std::fs::hard_link(temp_path, target) {
        Ok(()) => {
            // 提交成功：temp 与 target 为同一 inode 的两个目录项，移除 temp 目录项，内容保留于 target。
            let _ = std::fs::remove_file(temp_path);
            Ok(())
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(DocumentError::SaveConflict)
        }
        Err(err) => Err(DocumentError::Io(err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::test_support::TestDir;
    use crate::document::{TextEncoding, open_document};
    use std::path::PathBuf;

    fn write_in(dir: &TestDir, name: &str, bytes: &[u8]) -> (PathBuf, FileFingerprint) {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        (path, FileFingerprint::of(bytes))
    }

    fn save(
        path: &Path,
        fingerprint: &FileFingerprint,
        content: &str,
        encoding: TextEncoding,
        line_ending: LineEnding,
    ) -> Result<SaveOutcome, DocumentError> {
        save_document(
            path,
            SaveRequest {
                content: content.to_owned(),
                encoding,
                line_ending,
                target: SaveTarget::InPlace {
                    source_read_only: false,
                    expected: fingerprint.clone(),
                },
            },
        )
    }

    fn assert_no_temp_residue(dir: &Path) {
        let residue: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".textora-save.")
            })
            .collect();
        assert!(
            residue.is_empty(),
            "temporary save files left behind: {residue:?}"
        );
    }

    #[test]
    fn utf8_round_trip_reopens_with_same_content_encoding_and_line_ending() {
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "utf8-lf.txt", b"hello\nworld\n");

        let outcome = save(
            &path,
            &fingerprint,
            "hello\nworld\n",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap();
        assert_eq!(outcome.byte_count, 12);
        assert_eq!(outcome.encoding, TextEncoding::Utf8 { bom: false });
        assert_eq!(outcome.line_ending, LineEnding::Lf);

        let reopened = open_document(&path).unwrap();
        assert_eq!(reopened.content, "hello\nworld\n");
        assert_eq!(
            reopened.descriptor.encoding,
            TextEncoding::Utf8 { bom: false }
        );
        assert_eq!(reopened.descriptor.line_ending, LineEnding::Lf);
    }

    #[test]
    fn utf8_bom_is_written_exactly_once_and_reopens_with_bom_flag() {
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "utf8-bom.txt", &[0xEF, 0xBB, 0xBF, b'x']);

        let outcome = save(
            &path,
            &fingerprint,
            "x",
            TextEncoding::Utf8 { bom: true },
            LineEnding::Lf,
        )
        .unwrap();
        let on_disk = std::fs::read(&path).unwrap();
        assert_eq!(on_disk, [0xEF, 0xBB, 0xBF, b'x']);
        assert_eq!(outcome.byte_count, 4);

        let reopened = open_document(&path).unwrap();
        assert_eq!(
            reopened.descriptor.encoding,
            TextEncoding::Utf8 { bom: true }
        );
        assert_eq!(reopened.content, "x");
    }

    #[test]
    fn utf8_without_bom_is_not_given_a_bom() {
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "utf8-nobom.txt", b"abc");
        save(
            &path,
            &fingerprint,
            "abc",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap();
        let on_disk = std::fs::read(&path).unwrap();
        assert!(!on_disk.starts_with(&[0xEF, 0xBB, 0xBF]));
    }

    #[test]
    fn cp936_round_trip_reopens_as_gbk() {
        let dir = TestDir::new();
        let original_bytes = [0xD6, 0xD0, 0xCE, 0xC4, 0x0D, 0x0A]; // 中文 + CRLF
        let (path, fingerprint) = write_in(&dir, "cp936-crlf.txt", &original_bytes);

        let outcome = save(
            &path,
            &fingerprint,
            "中文\r\n",
            TextEncoding::Gbk,
            LineEnding::Crlf,
        )
        .unwrap();
        assert_eq!(outcome.encoding, TextEncoding::Gbk);
        assert_eq!(std::fs::read(&path).unwrap(), original_bytes);

        let reopened = open_document(&path).unwrap();
        assert_eq!(reopened.content, "中文\r\n");
        assert_eq!(reopened.descriptor.encoding, TextEncoding::Gbk);
        assert_eq!(reopened.descriptor.line_ending, LineEnding::Crlf);
    }

    #[test]
    fn cp936_ambiguous_content_is_refused_at_save() {
        // 「一」的 GBK 字节 D2 BB 也合法 UTF-8，保存后会被 open_document 按 UTF-8 优先
        // 误开，故核心以 EncodingAmbiguous 拒绝，且不改动原文件。
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "ambiguous.txt", b"seed");
        let err = save(&path, &fingerprint, "一", TextEncoding::Gbk, LineEnding::Lf).unwrap_err();
        assert!(matches!(err, DocumentError::EncodingAmbiguous));
        assert_eq!(std::fs::read(&path).unwrap(), b"seed");
    }

    #[test]
    fn mixed_target_is_rejected_and_original_unchanged() {
        let dir = TestDir::new();
        let original = b"line1\nline2";
        let (path, fingerprint) = write_in(&dir, "mixed-target.txt", original);
        let err = save(
            &path,
            &fingerprint,
            "line1\nline2",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Mixed,
        )
        .unwrap_err();
        assert!(matches!(err, DocumentError::MixedLineEndingNotChosen));
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn cp936_unencodable_is_rejected_before_write_with_position() {
        let dir = TestDir::new();
        let original = b"ok";
        let (path, fingerprint) = write_in(&dir, "cp936-bad.txt", original);
        let err = save(
            &path,
            &fingerprint,
            "ok 😀",
            TextEncoding::Gbk,
            LineEnding::Lf,
        )
        .unwrap_err();
        match err {
            DocumentError::UnencodableContent {
                character,
                byte_offset,
            } => {
                assert_eq!(character, '😀');
                assert_eq!(&"ok 😀"[byte_offset..], "😀");
            }
            other => panic!("expected UnencodableContent, got {other:?}"),
        }
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn conflict_when_file_missing() {
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "then-removed.txt", b"was here");
        std::fs::remove_file(&path).unwrap();
        let err = save(
            &path,
            &fingerprint,
            "was here",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap_err();
        assert!(matches!(err, DocumentError::SaveConflict));
        assert!(!path.exists());
    }

    #[test]
    fn conflict_when_file_modified_externally_does_not_overwrite() {
        let dir = TestDir::new();
        let original = b"original";
        let (path, fingerprint) = write_in(&dir, "externally-modified.txt", original);
        std::fs::write(&path, b"changed by another process").unwrap();

        let err = save(
            &path,
            &fingerprint,
            "original",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap_err();
        assert!(matches!(err, DocumentError::SaveConflict));
        assert_eq!(std::fs::read(&path).unwrap(), b"changed by another process");
    }

    #[test]
    fn read_only_is_rejected_and_original_unchanged() {
        let dir = TestDir::new();
        let original = b"ro";
        let (path, fingerprint) = write_in(&dir, "read-only.txt", original);
        let err = save_document(
            &path,
            SaveRequest {
                content: "changed".to_owned(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                target: SaveTarget::InPlace {
                    source_read_only: true,
                    expected: fingerprint.clone(),
                },
            },
        )
        .unwrap_err();
        assert!(matches!(err, DocumentError::ReadOnly));
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[test]
    fn successful_save_leaves_no_temp_file_and_fingerprint_matches_disk() {
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "clean-save.txt", b"old");
        let outcome = save(
            &path,
            &fingerprint,
            "new content",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap();

        assert_no_temp_residue(dir.path());

        let on_disk = std::fs::read(&path).unwrap();
        assert_eq!(FileFingerprint::of(&on_disk), outcome.fingerprint);
        assert_eq!(outcome.byte_count, on_disk.len() as u64);
    }

    #[test]
    fn over_limit_content_is_rejected_before_write() {
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "oversized.txt", b"seed");
        let too_large = vec![b'a'; (MAX_FILE_SIZE_BYTES + 1) as usize];
        let content = String::from_utf8(too_large).unwrap();
        let err = save(
            &path,
            &fingerprint,
            &content,
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap_err();
        assert!(matches!(err, DocumentError::SizeLimitExceeded { .. }));
        // 原文件不变。
        assert_eq!(std::fs::read(&path).unwrap(), b"seed");
    }

    #[cfg(unix)]
    #[test]
    fn temp_creation_failure_leaves_original_intact() {
        // 用只读目录让临时文件创建失败，验证写入失败路径不破坏原文件且不残留临时文件。
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new();
        let nested = dir.join("readonly-dir");
        std::fs::create_dir_all(&nested).unwrap();
        let path = nested.join("inside.txt");
        std::fs::write(&path, b"original").unwrap();
        let fingerprint = FileFingerprint::of(b"original");

        std::fs::set_permissions(&nested, PermissionsExt::from_mode(0o500)).unwrap();
        let result = save(
            &path,
            &fingerprint,
            "changed",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        );
        std::fs::set_permissions(&nested, PermissionsExt::from_mode(0o700)).unwrap();

        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"original");
        assert_no_temp_residue(&nested);
    }

    #[test]
    fn best_effort_recheck_detects_external_change_before_replace_and_cleans_temp() {
        // best-effort：临时文件写入并同步后、替换前的再次校验能发现已被外部修改的目标，
        // 保留外部内容并清理临时文件。注意这缩小但未严格关闭再次校验与 rename 之间的窗口。
        let dir = TestDir::new();
        let path = dir.join("race.txt");
        std::fs::write(&path, b"original").unwrap();
        let fingerprint = FileFingerprint::of(b"original");
        let target = path.clone();

        let err = save_document_with_before_replace(
            &path,
            SaveRequest {
                content: "my edit".to_owned(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                target: SaveTarget::InPlace {
                    source_read_only: false,
                    expected: fingerprint.clone(),
                },
            },
            || {
                std::fs::write(&target, b"changed by another process").unwrap();
            },
        )
        .unwrap_err();

        assert!(matches!(err, DocumentError::SaveConflict));
        assert_eq!(std::fs::read(&path).unwrap(), b"changed by another process");
        assert_no_temp_residue(dir.path());
    }

    #[cfg(unix)]
    #[test]
    fn save_preserves_restrictive_file_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "perms-0600.txt", b"secret");
        std::fs::set_permissions(&path, PermissionsExt::from_mode(0o600)).unwrap();

        save(
            &path,
            &fingerprint,
            "secret",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap();

        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(
            mode & 0o777,
            0o600,
            "restrictive permissions must be preserved across the atomic replace"
        );
    }

    #[cfg(unix)]
    #[test]
    fn save_rejects_file_that_became_read_only_since_open() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new();
        let (path, fingerprint) = write_in(&dir, "became-ro.txt", b"orig");
        // 指纹建立时文件可写；保存前改为只读，核心必须重新检查并拒绝。
        std::fs::set_permissions(&path, PermissionsExt::from_mode(0o444)).unwrap();

        let err = save(
            &path,
            &fingerprint,
            "new",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap_err();

        assert!(matches!(err, DocumentError::ReadOnly));
        assert_eq!(std::fs::read(&path).unwrap(), b"orig");
        std::fs::set_permissions(&path, PermissionsExt::from_mode(0o644)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn save_refuses_target_flipped_to_read_only_before_replace() {
        // 内容未变，但 before_replace 阶段把目标改为只读：最终替换前的只读重检必须拒绝，
        // 且不把旧的可写权限写回（目标保持 0444 与原内容），临时文件被清理。
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new();
        let path = dir.join("flipped-ro.txt");
        std::fs::write(&path, b"orig").unwrap();
        let fingerprint = FileFingerprint::of(b"orig");
        let target = path.clone();

        let err = save_document_with_before_replace(
            &path,
            SaveRequest {
                content: "orig".to_owned(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                target: SaveTarget::InPlace {
                    source_read_only: false,
                    expected: fingerprint.clone(),
                },
            },
            || {
                std::fs::set_permissions(&target, PermissionsExt::from_mode(0o444)).unwrap();
            },
        )
        .unwrap_err();

        assert!(matches!(err, DocumentError::ReadOnly));
        assert_eq!(std::fs::read(&path).unwrap(), b"orig");
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o444, "read-only flip must not be reverted");
        assert_no_temp_residue(dir.path());
        std::fs::set_permissions(&path, PermissionsExt::from_mode(0o644)).unwrap();
    }

    #[test]
    fn cp936_ascii_content_is_refused_to_preserve_encoding() {
        // GBK 文档被编辑为纯 ASCII 后，字节会按 UTF-8 优先重开，无法保持 GBK 编码身份。
        let dir = TestDir::new();
        let original = [0xD6, 0xD0, 0xCE, 0xC4]; // 中文
        let (path, fingerprint) = write_in(&dir, "ascii-as-gbk.txt", &original);
        let err = save(
            &path,
            &fingerprint,
            "plain ascii",
            TextEncoding::Gbk,
            LineEnding::Lf,
        )
        .unwrap_err();
        assert!(matches!(err, DocumentError::EncodingAmbiguous));
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }

    #[cfg(unix)]
    #[test]
    fn save_via_symlink_updates_resolved_target_and_keeps_link() {
        // 通过符号链接保存：rename 不应替换链接目录项，而应解析到真实目标并对其原子替换。
        use std::os::unix::fs::symlink;
        let dir = TestDir::new();
        let target = dir.join("real.txt");
        std::fs::write(&target, b"orig").unwrap();
        let link = dir.join("link.txt");
        symlink(&target, &link).unwrap();
        let fingerprint = FileFingerprint::of(b"orig");

        save(
            &link,
            &fingerprint,
            "updated",
            TextEncoding::Utf8 { bom: false },
            LineEnding::Lf,
        )
        .unwrap();

        // 链接仍然存在且仍是指向真实目标的符号链接。
        let link_meta = std::fs::symlink_metadata(&link).unwrap();
        assert!(
            link_meta.file_type().is_symlink(),
            "symlink must not be replaced by a regular file"
        );
        // 真实目标内容已更新；经链接读取到的也是新内容。
        assert_eq!(std::fs::read(&target).unwrap(), b"updated");
        assert_eq!(std::fs::read(&link).unwrap(), b"updated");
    }

    #[test]
    fn new_target_creates_file_atomically_without_overwrite() {
        // 首次保存到尚不存在的目标：临时文件 + 同步 + hard_link 原子提交。
        let dir = TestDir::new();
        let path = dir.join("first-save.txt");
        let outcome = save_document(
            &path,
            SaveRequest {
                content: "fresh content".to_owned(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                target: SaveTarget::NewTarget,
            },
        )
        .unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"fresh content");
        assert_eq!(outcome.byte_count, 13);
        assert_eq!(FileFingerprint::of(b"fresh content"), outcome.fingerprint);
        assert_no_temp_residue(dir.path());
    }

    #[test]
    fn new_target_refuses_when_target_appears_and_leaves_only_temp() {
        // 首次观测时目标不存在；before_replace 阶段被其他进程创建 → hard_link 失败为
        // SaveConflict，绝不覆盖新出现的文件，且仅残留临时文件（随后被清理）。
        let dir = TestDir::new();
        let path = dir.join("appeared.txt");
        let created = path.clone();

        let err = save_document_with_before_replace(
            &path,
            SaveRequest {
                content: "mine".to_owned(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                target: SaveTarget::NewTarget,
            },
            || {
                std::fs::write(&created, b"created by another process").unwrap();
            },
        )
        .unwrap_err();

        assert!(matches!(err, DocumentError::SaveConflict));
        // 新出现的文件被保留，未被覆盖。
        assert_eq!(std::fs::read(&path).unwrap(), b"created by another process");
        assert_no_temp_residue(dir.path());
    }

    #[test]
    fn existing_target_saves_with_observed_fingerprint_and_preserves_perms() {
        // 另存为到已存在的不同目标：以对话框返回后观测到的指纹做 best-effort 校验并原子替换。
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = TestDir::new();
            let path = dir.join("existing.txt");
            std::fs::write(&path, b"old").unwrap();
            std::fs::set_permissions(&path, PermissionsExt::from_mode(0o600)).unwrap();
            let observed = FileFingerprint::of(b"old");

            let outcome = save_document(
                &path,
                SaveRequest {
                    content: "new".to_owned(),
                    encoding: TextEncoding::Utf8 { bom: false },
                    line_ending: LineEnding::Lf,
                    target: SaveTarget::ExistingTarget { observed },
                },
            )
            .unwrap();

            assert_eq!(std::fs::read(&path).unwrap(), b"new");
            assert_eq!(outcome.byte_count, 3);
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(
                mode & 0o777,
                0o600,
                "existing target perms must be preserved"
            );
        }
    }

    #[test]
    fn existing_target_refuses_when_changed_since_observation() {
        let dir = TestDir::new();
        let path = dir.join("existing-changed.txt");
        std::fs::write(&path, b"observed").unwrap();
        let observed = FileFingerprint::of(b"observed");
        let target = path.clone();

        let err = save_document_with_before_replace(
            &path,
            SaveRequest {
                content: "new".to_owned(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                target: SaveTarget::ExistingTarget { observed },
            },
            || {
                std::fs::write(&target, b"changed after observation").unwrap();
            },
        )
        .unwrap_err();

        assert!(matches!(err, DocumentError::SaveConflict));
        assert_eq!(std::fs::read(&path).unwrap(), b"changed after observation");
        assert_no_temp_residue(dir.path());
    }

    #[cfg(unix)]
    #[test]
    fn save_as_skips_source_read_only_for_a_different_target() {
        // 只读源可另存到其他可写目标：SaveTarget::NewTarget/ExistingTarget 不校验源只读。
        use std::os::unix::fs::PermissionsExt;
        let dir = TestDir::new();
        let source = dir.join("readonly-source.txt");
        std::fs::write(&source, b"src").unwrap();
        std::fs::set_permissions(&source, PermissionsExt::from_mode(0o444)).unwrap();
        let destination = dir.join("new-target.txt");

        save_document(
            &destination,
            SaveRequest {
                content: "src content".to_owned(),
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                target: SaveTarget::NewTarget,
            },
        )
        .unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"src content");
        // 源仍只读、未被改动。
        assert_eq!(std::fs::read(&source).unwrap(), b"src");
        let mode = std::fs::metadata(&source).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o444);
        std::fs::set_permissions(&source, PermissionsExt::from_mode(0o644)).unwrap();
    }
}
