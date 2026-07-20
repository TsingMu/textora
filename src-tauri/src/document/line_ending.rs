use serde::Serialize;

/// 文件中观察到的换行风格。孤立 CR（经典 Mac）与 LF/CRLF 混合均归为 Mixed，
/// 促使首次保存前显式选择 LF 或 CRLF。无任何换行时按 LF 默认。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Mixed,
}

/// 对已解码的 Unicode 文本分类换行风格。
///
/// `\r` 与 `\n` 均为 ASCII，扫描 UTF-8 字节不会与多字节序列冲突。
pub fn classify(text: &str) -> LineEnding {
    let bytes = text.as_bytes();
    let mut lone_lf = 0u64;
    let mut crlf = 0u64;
    let mut lone_cr = 0u64;

    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\r' if i + 1 < bytes.len() && bytes[i + 1] == b'\n' => {
                crlf += 1;
                i += 2;
            }
            b'\r' => {
                lone_cr += 1;
                i += 1;
            }
            b'\n' => {
                lone_lf += 1;
                i += 1;
            }
            _ => i += 1,
        }
    }

    if lone_cr > 0 || (lone_lf > 0 && crlf > 0) {
        LineEnding::Mixed
    } else if crlf > 0 {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_newline_defaults_to_lf() {
        assert_eq!(classify("abc"), LineEnding::Lf);
        assert_eq!(classify(""), LineEnding::Lf);
    }

    #[test]
    fn lf_only() {
        assert_eq!(classify("a\nb"), LineEnding::Lf);
        assert_eq!(classify("\n\n\n"), LineEnding::Lf);
    }

    #[test]
    fn crlf_only() {
        assert_eq!(classify("a\r\nb"), LineEnding::Crlf);
        assert_eq!(classify("\r\n\r\n"), LineEnding::Crlf);
    }

    #[test]
    fn mixed_lf_and_crlf() {
        assert_eq!(classify("a\nb\r\nc"), LineEnding::Mixed);
    }

    #[test]
    fn lone_cr_is_mixed() {
        assert_eq!(classify("a\rb"), LineEnding::Mixed);
        assert_eq!(classify("\r"), LineEnding::Mixed);
    }
}
