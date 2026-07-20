use serde::Serialize;
use sha2::{Digest, Sha256};

/// 文件快照的内容指纹，用于后续外部修改检测。基于原始字节，因此编码或
/// 任何字节层面的改动都会改变指纹。std 的 DefaultHasher 不保证跨版本稳定，
/// 故使用 SHA-256 以保证相同快照在进程与版本间稳定可比。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FileFingerprint {
    pub size_bytes: u64,
    pub sha256: String,
}

impl FileFingerprint {
    pub fn of(bytes: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let digest = hasher.finalize();
        Self {
            size_bytes: bytes.len() as u64,
            sha256: hex_lower(&digest),
        }
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(TABLE[(b >> 4) as usize] as char);
        out.push(TABLE[(b & 0x0F) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_bytes_produce_same_fingerprint() {
        let a = FileFingerprint::of(b"hello");
        let b = FileFingerprint::of(b"hello");
        assert_eq!(a, b);
        assert_eq!(a.size_bytes, 5);
    }

    #[test]
    fn different_bytes_produce_different_fingerprint() {
        let a = FileFingerprint::of(b"hello");
        let b = FileFingerprint::of(b"hellp");
        assert_ne!(a.sha256, b.sha256);
    }

    #[test]
    fn empty_input_matches_known_sha256() {
        let fp = FileFingerprint::of(b"");
        assert_eq!(fp.size_bytes, 0);
        assert_eq!(
            fp.sha256,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn fingerprint_is_lowercase_hex() {
        let fp = FileFingerprint::of(b"data");
        assert_eq!(fp.sha256.len(), 64);
        assert!(
            fp.sha256
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        );
    }
}
