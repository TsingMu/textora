use std::fmt;
use std::io;

use crate::document::MAX_FILE_SIZE_BYTES;

#[derive(Debug)]
pub enum DocumentError {
    SizeLimitExceeded {
        size: u64,
        limit: u64,
    },
    InvalidEncoding,
    ChangedDuringRead,
    Io(io::Error),
    /// 目标文档标记为只读，普通保存被拒绝。
    ReadOnly,
    /// 原文档换行为 Mixed，调用方未明确提供 LF 或 CRLF 保存目标。
    MixedLineEndingNotChosen,
    /// 内容含目标编码无法表示的字符；携带首个失败字符与其在输入中的 UTF-8 字节偏移，
    /// 供上层形成可理解提示。不携带任何文件系统路径。
    UnencodableContent {
        character: char,
        byte_offset: usize,
    },
    /// 保存前磁盘文件缺失或与打开时指纹不一致，拒绝覆盖。
    SaveConflict,
    /// 目标编码（当前为 GBK/CP936）的字节也合法 UTF-8：本工程的打开流程按 UTF-8 优先
    /// 检测，重开时会丢失 GBK 编码身份，且可能得到不同内容（如「一」的 GBK 字节
    /// `D2 BB` 会被读成 U+04BB）。核心无法在带内可靠区分二者，故拒绝保存，交由上层
    /// 选择另存为 UTF-8 等可靠方案。
    EncodingAmbiguous,
}

impl fmt::Display for DocumentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DocumentError::SizeLimitExceeded { size, limit } => {
                write!(f, "file size {size} bytes exceeds the {limit} byte limit")
            }
            DocumentError::InvalidEncoding => write!(
                f,
                "input is not valid UTF-8 (with optional BOM) or strict GBK/CP936; GB18030 four-byte sequences are rejected"
            ),
            DocumentError::ChangedDuringRead => {
                write!(f, "file changed while Textora was reading it")
            }
            DocumentError::Io(err) => write!(f, "file I/O failed: {err}"),
            DocumentError::ReadOnly => write!(f, "document is read-only and cannot be saved"),
            DocumentError::MixedLineEndingNotChosen => write!(
                f,
                "document has mixed line endings; choose LF or CRLF before saving"
            ),
            DocumentError::UnencodableContent {
                character,
                byte_offset,
            } => write!(
                f,
                "content contains a character that cannot be represented in the target encoding (first U+{:04X} at byte offset {byte_offset})",
                u32::from(*character)
            ),
            DocumentError::SaveConflict => write!(
                f,
                "the file changed on disk since it was opened; saving was refused to avoid overwriting changes"
            ),
            DocumentError::EncodingAmbiguous => write!(
                f,
                "the GBK encoding of this content is indistinguishable from UTF-8 and would not reopen as GBK; save as UTF-8 instead"
            ),
        }
    }
}

impl std::error::Error for DocumentError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DocumentError::Io(err) => Some(err),
            _ => None,
        }
    }
}

impl From<io::Error> for DocumentError {
    fn from(err: io::Error) -> Self {
        DocumentError::Io(err)
    }
}

impl DocumentError {
    pub fn size_limit_exceeded(size: u64) -> Self {
        DocumentError::SizeLimitExceeded {
            size,
            limit: MAX_FILE_SIZE_BYTES,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error as _;

    #[test]
    fn size_limit_message_reports_size_and_limit() {
        let err = DocumentError::size_limit_exceeded(MAX_FILE_SIZE_BYTES + 1);
        let msg = err.to_string();
        assert!(msg.contains(&MAX_FILE_SIZE_BYTES.to_string()));
        assert!(msg.contains(&(MAX_FILE_SIZE_BYTES + 1).to_string()));
    }

    #[test]
    fn io_error_is_mapped_and_source_is_preserved() {
        let io = io::Error::new(io::ErrorKind::NotFound, "missing");
        let err: DocumentError = io.into();
        assert!(matches!(err, DocumentError::Io(_)));
        assert!(err.source().is_some());
        assert!(err.to_string().contains("missing"));
    }
}
