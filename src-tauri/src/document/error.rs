use std::fmt;
use std::io;

use crate::document::MAX_FILE_SIZE_BYTES;

#[derive(Debug)]
pub enum DocumentError {
    SizeLimitExceeded { size: u64, limit: u64 },
    InvalidEncoding,
    ChangedDuringRead,
    Io(io::Error),
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
