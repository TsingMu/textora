use serde::Serialize;

use crate::document::error::DocumentError;

/// 文本编码。UTF-8 的 BOM 作为标记保留；GBK 即严格 Windows CP936。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TextEncoding {
    Utf8 { bom: bool },
    Gbk,
}

/// 按已确认顺序识别编码并解码为 Unicode 文本。
///
/// 顺序：UTF-8 BOM → 严格 UTF-8 → 严格 GBK/CP936。
/// - 带 UTF-8 BOM 时按 UTF-8 处理；若 BOM 之后的字节非法，直接拒绝，不回退到 GBK。
/// - 纯 ASCII 在严格 UTF-8 分支即命中，归为 UTF-8。
/// - GBK 分支先按 Microsoft CP936 映射范围拒绝 GB18030 四字节、
///   超集专有双字节位置与非法帧。任何错误均整体拒绝，绝不外泄替换字符。
pub fn detect_and_decode(bytes: &[u8]) -> Result<(TextEncoding, String), DocumentError> {
    const BOM: &[u8; 3] = &[0xEF, 0xBB, 0xBF];

    if bytes.starts_with(BOM) {
        let body = &bytes[BOM.len()..];
        let text = std::str::from_utf8(body)
            .map_err(|_| DocumentError::InvalidEncoding)?
            .to_owned();
        return Ok((TextEncoding::Utf8 { bom: true }, text));
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok((TextEncoding::Utf8 { bom: false }, text.to_owned()));
    }

    validate_cp936_structure(bytes)?;
    let (cow, had_errors) = encoding_rs::GBK.decode_without_bom_handling(bytes);
    if had_errors {
        return Err(DocumentError::InvalidEncoding);
    }
    Ok((TextEncoding::Gbk, cow.into_owned()))
}

/// 按 Microsoft CP936 映射表校验字节：单字节 ASCII（含 0x80 → €）
/// 与表中已定义的双字节序列。这不只检查引导/尾字节范围：
/// `encoding_rs::GBK` 的解码端是 GB18030 超集，会接受 CP936 未定义的
/// 双字节位置，因此必须在调用它之前按 CP936 成员范围过滤。
///
/// 范围来源：Unicode Consortium 的 Microsoft CP936 映射表（v2.01）。
fn validate_cp936_structure(bytes: &[u8]) -> Result<(), DocumentError> {
    let mut i = 0;
    while i < bytes.len() {
        let lead = bytes[i];
        if lead <= 0x7F || lead == 0x80 {
            i += 1;
            continue;
        }
        if !(0x81..=0xFE).contains(&lead) {
            return Err(DocumentError::InvalidEncoding);
        }
        let Some(&trail) = bytes.get(i + 1) else {
            return Err(DocumentError::InvalidEncoding);
        };
        if is_cp936_double_byte(lead, trail) {
            i += 2;
            continue;
        }
        return Err(DocumentError::InvalidEncoding);
    }
    Ok(())
}

fn is_cp936_double_byte(lead: u8, trail: u8) -> bool {
    let full_trail = || matches!(trail, 0x40..=0x7E | 0x80..=0xFE);
    let extension_trail = || matches!(trail, 0x40..=0x7E | 0x80..=0xA0);

    match lead {
        0x81..=0xA0 | 0xB0..=0xD6 | 0xD8..=0xF7 => full_trail(),
        0xA1 | 0xA3 => matches!(trail, 0xA1..=0xFE),
        0xA2 => matches!(
            trail,
            0xA1..=0xAA | 0xB1..=0xE2 | 0xE5..=0xEE | 0xF1..=0xFC
        ),
        0xA4 => matches!(trail, 0xA1..=0xF3),
        0xA5 => matches!(trail, 0xA1..=0xF6),
        0xA6 => matches!(
            trail,
            0xA1..=0xB8 | 0xC1..=0xD8 | 0xE0..=0xEB | 0xEE..=0xF2 | 0xF4..=0xF5
        ),
        0xA7 => matches!(trail, 0xA1..=0xC1 | 0xD1..=0xF1),
        0xA8 => matches!(
            trail,
            0x40..=0x7E | 0x80..=0x95 | 0xA1..=0xBB | 0xBD..=0xBE | 0xC0 | 0xC5..=0xE9
        ),
        0xA9 => matches!(
            trail,
            0x40..=0x57 | 0x59..=0x5A | 0x5C | 0x60..=0x7E | 0x80..=0x88 | 0x96 | 0xA4..=0xEF
        ),
        0xAA..=0xAF | 0xF8..=0xFD => extension_trail(),
        0xD7 => matches!(trail, 0x40..=0x7E | 0x80..=0xF9),
        0xFE => matches!(trail, 0x40..=0x4F),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_is_utf8_without_bom() {
        let (enc, text) = detect_and_decode(b"").unwrap();
        assert_eq!(enc, TextEncoding::Utf8 { bom: false });
        assert!(text.is_empty());
    }

    #[test]
    fn pure_ascii_is_utf8() {
        let (enc, text) = detect_and_decode(b"hello world").unwrap();
        assert_eq!(enc, TextEncoding::Utf8 { bom: false });
        assert_eq!(text, "hello world");
    }

    #[test]
    fn utf8_multibyte_is_utf8() {
        let bytes = "café — 中文".as_bytes();
        let (enc, text) = detect_and_decode(bytes).unwrap();
        assert_eq!(enc, TextEncoding::Utf8 { bom: false });
        assert_eq!(text.as_bytes(), bytes);
    }

    #[test]
    fn utf8_bom_is_stripped_and_flagged() {
        let bytes = [0xEF, 0xBB, 0xBF, b'h', b'i'];
        let (enc, text) = detect_and_decode(&bytes).unwrap();
        assert_eq!(enc, TextEncoding::Utf8 { bom: true });
        assert_eq!(text, "hi");
        assert!(!text.contains('\u{FEFF}'));
    }

    #[test]
    fn utf8_bom_with_invalid_body_is_rejected() {
        // BOM 声明 UTF-8，但后续字节非法；不回退 GBK，直接拒绝。
        let bytes = [0xEF, 0xBB, 0xBF, 0xC0, 0x80];
        assert!(matches!(
            detect_and_decode(&bytes),
            Err(DocumentError::InvalidEncoding)
        ));
    }

    #[test]
    fn valid_gbk_decodes_without_replacement() {
        // GBK：中 = D6 D0，文 = CE C4。
        let bytes = [0xD6, 0xD0, 0xCE, 0xC4];
        let (enc, text) = detect_and_decode(&bytes).unwrap();
        assert_eq!(enc, TextEncoding::Gbk);
        assert_eq!(text, "中文");
        assert!(!text.contains('\u{FFFD}'));
    }

    #[test]
    fn cp936_single_byte_euro_is_supported() {
        let (enc, text) = detect_and_decode(&[0x80]).unwrap();
        assert_eq!(enc, TextEncoding::Gbk);
        assert_eq!(text, "€");
    }

    #[test]
    fn cp936_boundary_double_byte_is_supported() {
        let (enc, text) = detect_and_decode(&[0xFE, 0x4F]).unwrap();
        assert_eq!(enc, TextEncoding::Gbk);
        assert!(!text.contains('\u{FFFD}'));
    }

    #[test]
    fn invalid_utf8_that_is_also_invalid_gbk_is_rejected() {
        // 0xFE 作为 GBK 引导字节，尾字节 0xFF 非法；同时也不是合法 UTF-8。
        let bytes = [0xFE, 0xFF];
        assert!(matches!(
            detect_and_decode(&bytes),
            Err(DocumentError::InvalidEncoding)
        ));
    }

    #[test]
    fn gb18030_four_byte_sequence_is_rejected() {
        // GB18030 四字节序列 81 30 81 30 在 GBK 中非法，必须被拒绝。
        let bytes = [0x81, 0x30, 0x81, 0x30];
        assert!(matches!(
            detect_and_decode(&bytes),
            Err(DocumentError::InvalidEncoding)
        ));
    }

    #[test]
    fn gb18030_superset_two_byte_positions_are_rejected() {
        // encoding_rs/WHATWG GBK 会解码这些位置，但 Microsoft CP936
        // v2.01 映射表中未定义，严格 CP936 必须拒绝。
        for bytes in [[0xA1, 0x40], [0xFE, 0x50]] {
            assert!(matches!(
                detect_and_decode(&bytes),
                Err(DocumentError::InvalidEncoding)
            ));
        }
    }

    #[test]
    fn cp936_double_byte_membership_matches_vendor_table_signature() {
        let mut count = 0u64;
        let mut sum = 0u64;
        let mut xor = 0u16;

        for lead in 0x81u8..=0xFE {
            for trail in 0u8..=0xFF {
                if is_cp936_double_byte(lead, trail) {
                    let code = u16::from(lead) << 8 | u16::from(trail);
                    count += 1;
                    sum += u64::from(code);
                    xor ^= code;
                }
            }
        }

        // Unicode Consortium Microsoft CP936 v2.01 中的双字节条目签名。
        assert_eq!(count, 21_791);
        assert_eq!(sum, 0x3FB6_8679);
        assert_eq!(xor, 0xD533);
    }

    #[test]
    fn lone_gbk_lead_byte_is_rejected() {
        let bytes = [0xD6];
        assert!(matches!(
            detect_and_decode(&bytes),
            Err(DocumentError::InvalidEncoding)
        ));
    }
}
