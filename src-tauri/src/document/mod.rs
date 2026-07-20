//! Rust 文档读取与识别核心。
//!
//! 本模块提供字节级的纯分析（`analyze`）和路径级的文档读取（`open_document`）。
//! 这些接口是内部 Rust 能力，尚未暴露为 Tauri 命令，因此前端不获得任何文件系统权限。

pub mod encoding;
pub mod error;
pub mod fingerprint;
pub mod line_ending;

use std::fs::{File, Metadata};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use same_file::Handle;
use serde::Serialize;

pub use encoding::TextEncoding;
pub use error::DocumentError;
pub use fingerprint::FileFingerprint;
pub use line_ending::LineEnding;

/// 首版单文件最大字节数：50 MiB。`size <= MAX` 可接受，`size > MAX` 明确失败。
pub const MAX_FILE_SIZE_BYTES: u64 = 50 * 1024 * 1024;

/// 文档元数据。字段对应 `docs/ARCHITECTURE.md` 的 `DocumentDescriptor`。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDescriptor {
    pub id: String,
    pub path: PathBuf,
    pub display_name: String,
    pub byte_count: u64,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
    pub fingerprint: FileFingerprint,
    pub read_only: bool,
}

/// 字节快照分析结果：编码、换行、指纹与已解码的 Unicode 内容。
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentSnapshot {
    pub byte_count: u64,
    pub encoding: TextEncoding,
    pub line_ending: LineEnding,
    pub fingerprint: FileFingerprint,
    pub content: String,
}

/// `open_document` 的返回：描述符与内容。内部使用，不跨 IPC。
#[derive(Debug, Clone, PartialEq)]
pub struct OpenedDocument {
    pub descriptor: DocumentDescriptor,
    pub content: String,
}

/// 进程内单调文档 ID。会话层（多标签）尚未实现，此 ID 仅用于填充描述符类型，
/// 后续会话层可接管 ID 语义。
static NEXT_DOCUMENT_ID: AtomicU64 = AtomicU64::new(1);

fn next_document_id() -> String {
    let n = NEXT_DOCUMENT_ID.fetch_add(1, Ordering::Relaxed);
    format!("doc-{n}")
}

/// 校验字节数是否在首版上限内。
pub fn check_size(size: u64) -> Result<(), DocumentError> {
    if size <= MAX_FILE_SIZE_BYTES {
        Ok(())
    } else {
        Err(DocumentError::size_limit_exceeded(size))
    }
}

/// 纯字节级分析：编码识别、换行分类、指纹与解码。无 I/O，可独立测试。
pub fn analyze(bytes: &[u8]) -> Result<DocumentSnapshot, DocumentError> {
    check_size(bytes.len() as u64)?;

    let (encoding, content) = encoding::detect_and_decode(bytes)?;
    let line_ending = line_ending::classify(&content);
    let fingerprint = FileFingerprint::of(bytes);

    Ok(DocumentSnapshot {
        byte_count: bytes.len() as u64,
        encoding,
        line_ending,
        fingerprint,
        content,
    })
}

fn read_bounded<R: Read>(
    reader: &mut R,
    expected_size: u64,
    limit: u64,
) -> Result<Vec<u8>, DocumentError> {
    let capacity = expected_size.min(limit) as usize;
    let mut bytes = Vec::with_capacity(capacity);
    reader.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(DocumentError::SizeLimitExceeded {
            size: bytes.len() as u64,
            limit,
        });
    }
    Ok(bytes)
}

fn metadata_changed(before: &Metadata, after: &Metadata) -> Result<bool, DocumentError> {
    Ok(before.len() != after.len() || before.modified()? != after.modified()?)
}

/// 读取文件并建立文档快照。整个过程只使用一个已打开文件句柄：
/// - 读取器最多消费 `MAX + 1` 字节，外部扩容不会绕过内存边界；
/// - 读取前后比较同一句柄的大小与修改时间；
/// - 读取后验证路径仍指向该句柄的文件，检测原子替换。
///
/// 任何变化都明确失败，由上层决定是否重试。本函数不是 Tauri 命令。
pub fn open_document(path: &Path) -> Result<OpenedDocument, DocumentError> {
    let file = File::open(path)?;
    let mut opened_handle = Handle::from_file(file)?;
    let before = opened_handle.as_file().metadata()?;
    check_size(before.len())?;

    let bytes = read_bounded(
        opened_handle.as_file_mut(),
        before.len(),
        MAX_FILE_SIZE_BYTES,
    )?;
    let after = opened_handle.as_file().metadata()?;
    let current_path_handle = Handle::from_path(path)?;
    if metadata_changed(&before, &after)? || opened_handle != current_path_handle {
        return Err(DocumentError::ChangedDuringRead);
    }

    let snapshot = analyze(&bytes)?;
    let display_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let descriptor = DocumentDescriptor {
        id: next_document_id(),
        path: path.to_path_buf(),
        display_name,
        byte_count: snapshot.byte_count,
        encoding: snapshot.encoding,
        line_ending: snapshot.line_ending,
        fingerprint: snapshot.fingerprint,
        read_only: after.permissions().readonly(),
    };

    Ok(OpenedDocument {
        descriptor,
        content: snapshot.content,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_size_accepts_boundary_and_rejects_over() {
        assert!(check_size(MAX_FILE_SIZE_BYTES).is_ok());
        assert!(check_size(0).is_ok());
        assert!(matches!(
            check_size(MAX_FILE_SIZE_BYTES + 1),
            Err(DocumentError::SizeLimitExceeded { .. })
        ));
    }

    #[test]
    fn bounded_reader_never_consumes_beyond_limit_plus_one() {
        let mut reader = std::io::Cursor::new(b"abcdef");
        let err = read_bounded(&mut reader, 6, 5).unwrap_err();
        assert!(matches!(
            err,
            DocumentError::SizeLimitExceeded { size: 6, limit: 5 }
        ));
        assert_eq!(reader.position(), 6);

        let mut at_limit = std::io::Cursor::new(b"abcde");
        assert_eq!(read_bounded(&mut at_limit, 5, 5).unwrap(), b"abcde");
    }

    #[test]
    fn analyze_gbk_with_lf_line_ending() {
        // GBK “中文\n”：中=D6D0，文=CEC4，后接 LF。
        let bytes = [0xD6, 0xD0, 0xCE, 0xC4, 0x0A];
        let snap = analyze(&bytes).unwrap();
        assert_eq!(snap.encoding, TextEncoding::Gbk);
        assert_eq!(snap.line_ending, LineEnding::Lf);
        assert_eq!(snap.byte_count, 5);
        assert_eq!(snap.content, "中文\n");
        assert_eq!(snap.fingerprint.size_bytes, 5);
    }

    #[test]
    fn analyze_utf8_bom_preserves_bom_flag_and_strips_bom() {
        let bytes = [0xEF, 0xBB, 0xBF, b'a', 0x0D, 0x0A];
        let snap = analyze(&bytes).unwrap();
        assert_eq!(snap.encoding, TextEncoding::Utf8 { bom: true });
        assert_eq!(snap.line_ending, LineEnding::Crlf);
        assert_eq!(snap.content, "a\r\n");
        // 指纹基于原始字节，仍包含 BOM。
        assert_eq!(snap.fingerprint.size_bytes, 6);
    }

    #[test]
    fn analyze_rejects_over_limit() {
        let over = vec![0u8; (MAX_FILE_SIZE_BYTES + 1) as usize];
        assert!(matches!(
            analyze(&over),
            Err(DocumentError::SizeLimitExceeded { .. })
        ));
    }

    #[test]
    fn open_document_reads_and_describes_file() {
        let dir = tempfile_dir();
        let path = dir.join("sample.txt");
        // GBK “中文”，CRLF。
        std::fs::write(&path, [0xD6, 0xD0, 0xCE, 0xC4, 0x0D, 0x0A]).unwrap();

        let opened = open_document(&path).unwrap();
        let descriptor = &opened.descriptor;
        assert_eq!(descriptor.display_name, "sample.txt");
        assert_eq!(descriptor.path, path);
        assert_eq!(descriptor.byte_count, 6);
        assert_eq!(descriptor.encoding, TextEncoding::Gbk);
        assert_eq!(descriptor.line_ending, LineEnding::Crlf);
        assert_eq!(opened.content, "中文\r\n");
        assert!(descriptor.id.starts_with("doc-"));
        assert_eq!(
            descriptor.fingerprint,
            FileFingerprint::of(&[0xD6, 0xD0, 0xCE, 0xC4, 0x0D, 0x0A])
        );
    }

    #[test]
    fn open_document_rejects_missing_file_without_writing() {
        let path = std::env::temp_dir().join("textora_definitely_missing_95c7.txt");
        let _ = std::fs::remove_file(&path);
        assert!(matches!(open_document(&path), Err(DocumentError::Io(_))));
    }

    /// 共享的测试输出目录，位于进程临时目录下。
    fn tempfile_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("textora_doc_core_tests");
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
