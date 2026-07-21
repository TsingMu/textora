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

/// 保存请求。字段由上层（已打开文档的描述信息）提供。
pub struct SaveRequest<'a> {
    pub content: &'a str,
    pub encoding: TextEncoding,
    /// 保存目标换行；`Mixed` 表示调用方未解析，核心会拒绝。
    pub line_ending: LineEnding,
    pub original_fingerprint: &'a FileFingerprint,
    /// 来自打开时描述符的只读标记；为真则拒绝普通保存。
    pub read_only: bool,
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
/// 顺序遵循 Feature Spec：描述符只读前置校验 → 解析符号链接到可靠目标 → 换行规范化与
/// 无替换编码 → 输出大小限制 → 初次指纹冲突检测 → 初次只读快检 → 对解析目标同目录原子
/// 替换（替换前 best-effort 再次校验冲突与只读/权限）。任一步失败都保留原文件。
pub fn save_document(path: &Path, request: SaveRequest<'_>) -> Result<SaveOutcome, DocumentError> {
    save_document_with_before_replace(path, request, || {})
}

/// 与 [`save_document`] 相同，额外提供 `before_replace` 缝：在临时文件完成写入与同步
/// 之后、最终校验与原子替换之前调用。测试用它确定性地模拟「校验与替换之间外部修改」。
pub(crate) fn save_document_with_before_replace<F>(
    path: &Path,
    request: SaveRequest<'_>,
    before_replace: F,
) -> Result<SaveOutcome, DocumentError>
where
    F: FnOnce(),
{
    if request.read_only {
        return Err(DocumentError::ReadOnly);
    }

    // 解析符号链接到真实目标：读取/校验本就跟随链接，若 rename 直接作用于链接路径会
    // 替换链接目录项（删除链接、原目标不变）。对解析后的真实目标做原子替换，可保留链接。
    let target = resolve_save_target(path)?;

    let normalized = line_ending::normalize(request.content, request.line_ending)?;
    let bytes = encoding::encode(&normalized, request.encoding)?;
    check_size(bytes.len() as u64)?;
    verify_no_conflict(&target, request.original_fingerprint)?;
    // 初次只读快检：明显只读时直接失败，避免无谓写临时文件；最终权限以替换前重读为准。
    capture_writable_permissions(&target)?;
    atomic_write_with_recheck(
        &target,
        &bytes,
        request.original_fingerprint,
        before_replace,
    )?;

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
                content,
                encoding,
                line_ending,
                original_fingerprint: fingerprint,
                read_only: false,
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
                content: "changed",
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                original_fingerprint: &fingerprint,
                read_only: true,
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
                content: "my edit",
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                original_fingerprint: &fingerprint,
                read_only: false,
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
                content: "orig",
                encoding: TextEncoding::Utf8 { bom: false },
                line_ending: LineEnding::Lf,
                original_fingerprint: &fingerprint,
                read_only: false,
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
}
