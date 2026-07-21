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

/// 将 Unicode 文本严格编码为目标字节。
///
/// - `Utf8 { bom: true }`：由编码层添加且仅添加一个 UTF-8 BOM；文本内容中既有的
///   U+FEFF 原样保留，不会被删改。
/// - `Utf8 { bom: false }`：纯 UTF-8，不添加 BOM。
/// - `Gbk`：严格 CP936。遇到无法表示的字符，或字符映射到 CP936 v2.01 未定义的位置
///   时，返回 `UnencodableContent`，携带首个失败字符与其 UTF-8 字节偏移；编码结果若
///   无法由本工程按 GBK 和原内容重开，则返回 `EncodingAmbiguous`。绝不插入替代字符。
pub fn encode(content: &str, encoding: TextEncoding) -> Result<Vec<u8>, DocumentError> {
    match encoding {
        TextEncoding::Utf8 { bom } => {
            let mut bytes = Vec::with_capacity(content.len() + 3);
            if bom {
                bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            bytes.extend_from_slice(content.as_bytes());
            Ok(bytes)
        }
        TextEncoding::Gbk => encode_cp936(content),
    }
}

fn encode_cp936(content: &str) -> Result<Vec<u8>, DocumentError> {
    let (cow, _, had_errors) = encoding_rs::GBK.encode(content);
    let bytes = cow.into_owned();

    if had_errors || validate_cp936_structure(&bytes).is_err() {
        let (byte_offset, character) = first_non_representable(content)
            .expect("encoding failed, so at least one character is not strict-CP936-representable");
        return Err(DocumentError::UnencodableContent {
            character,
            byte_offset,
        });
    }

    // 可编码且为严格 CP936。只有这些字节经本工程打开流程后仍识别为 GBK 且内容一致，
    // 才能满足普通保存保持编码与内容的约束。若字节也构成合法 UTF-8（包括纯 ASCII 与
    // 空内容），重开会丢失 GBK 编码身份或得到不同内容，核心无法在带内可靠区分，故拒绝
    // 并交由上层提示另存为 UTF-8（见 D-006）。
    if !reopens_as_same_encoding_and_content(&bytes, content) {
        return Err(DocumentError::EncodingAmbiguous);
    }

    Ok(bytes)
}

/// 编码后的字节经本工程打开流程能否仍识别为 GBK，并还原为同一内容。
fn reopens_as_same_encoding_and_content(bytes: &[u8], expected: &str) -> bool {
    matches!(
        detect_and_decode(bytes),
        Ok((TextEncoding::Gbk, ref decoded)) if decoded == expected
    )
}

/// 判定文本能否被严格 CP936 完整编码：`encoding_rs::GBK` 能无替换编码（`had_errors`
/// 为假），且编码后的字节全部落在 Microsoft CP936 v2.01 已定义的成员范围内（由
/// `validate_cp936_structure` 校验）。
///
/// 不得改用 UTF-8 优先的 `detect_and_decode` 做可表示性判定：例如「一」（U+4E00）
/// 的 GBK 字节 `D2 BB` 恰好也是合法的 UTF-8 双字节序列（解码为 U+04BB），会被
/// 检测顺序误归为 UTF-8，从而把合法 CP936 字符误报为不可编码。
fn cp936_encodable_strictly(content: &str) -> bool {
    let (cow, _, had_errors) = encoding_rs::GBK.encode(content);
    !had_errors && validate_cp936_structure(cow.as_ref()).is_ok()
}

/// 在已知无法严格编码的文本中，定位首个不可表示字符及其 UTF-8 字节偏移。
///
/// “前缀 [..p] 可严格编码” 单调（一旦为假保持为假），因此对字符边界做二分，找到
/// 最小的不可编码前缀长度；其末尾字符即首个不可表示字符。
fn first_non_representable(content: &str) -> Option<(usize, char)> {
    let mut lo = 0usize;
    let mut hi = content.len();
    while hi - lo > 1 {
        let mid = content.floor_char_boundary(lo + (hi - lo) / 2);
        let probe = if mid <= lo {
            // 中点退化为 lo，步进到下一个字符边界
            let step = lo + content[lo..].chars().next()?.len_utf8();
            if step >= hi {
                break;
            }
            step
        } else {
            mid
        };
        if cp936_encodable_strictly(&content[..probe]) {
            lo = probe;
        } else {
            hi = probe;
        }
    }
    content[..hi]
        .char_indices()
        .next_back()
        .map(|(offset, character)| (offset, character))
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

    #[test]
    fn encode_utf8_without_bom_preserves_content_and_adds_no_bom() {
        let bytes = encode("café\n", TextEncoding::Utf8 { bom: false }).unwrap();
        assert_eq!(bytes, "café\n".as_bytes());
        assert!(!bytes.starts_with(&[0xEF, 0xBB, 0xBF]));
    }

    #[test]
    fn encode_utf8_with_bom_adds_exactly_one_bom_and_keeps_inner_feff() {
        // 文本自身包含一个 U+FEFF；编码层只能再添加一个 BOM，且不得删改既有 U+FEFF。
        let content = "a\u{FEFF}b";
        let bytes = encode(content, TextEncoding::Utf8 { bom: true }).unwrap();
        assert_eq!(bytes, [0xEF, 0xBB, 0xBF, b'a', 0xEF, 0xBB, 0xBF, b'b']);
    }

    #[test]
    fn encode_cp936_round_trips_with_strict_decode() {
        let bytes = encode("中文 abc", TextEncoding::Gbk).unwrap();
        let (encoding, decoded) = detect_and_decode(&bytes).unwrap();
        assert_eq!(encoding, TextEncoding::Gbk);
        assert_eq!(decoded, "中文 abc");
    }

    #[test]
    fn encode_cp936_requires_reopen_as_gbk_with_same_content() {
        // 「一」(U+4E00) 的 GBK 字节 D2 BB 恰为合法 UTF-8，按 UTF-8 优先重开会读成
        // U+04BB——与原内容不同，故拒绝为 EncodingAmbiguous。
        assert!(matches!(
            encode("一", TextEncoding::Gbk),
            Err(DocumentError::EncodingAmbiguous)
        ));
        let (encoding, decoded) = detect_and_decode(&[0xD2, 0xBB]).unwrap();
        assert_eq!(encoding, TextEncoding::Utf8 { bom: false });
        assert_eq!(decoded, "\u{4BB}");

        // 纯 ASCII 与空内容虽能被 GBK 编码，但按 UTF-8 优先重开会丢失 GBK 编码身份，
        // 因而不能满足普通保存保持编码的约束。
        assert!(matches!(
            encode("", TextEncoding::Gbk),
            Err(DocumentError::EncodingAmbiguous)
        ));
        assert!(matches!(
            encode("plain ascii", TextEncoding::Gbk),
            Err(DocumentError::EncodingAmbiguous)
        ));

        // 「一」与字节并非合法 UTF-8 的字符（如「中」）混排时，整体按 GBK 重开，「一」
        // 也能正确解码，故可正常保存。
        let bytes = encode("一 中", TextEncoding::Gbk).unwrap();
        let (encoding, decoded) = detect_and_decode(&bytes).unwrap();
        assert_eq!(encoding, TextEncoding::Gbk);
        assert_eq!(decoded, "一 中");
    }

    #[test]
    fn encode_cp936_rejects_unrepresentable_character_with_position() {
        // U+1F600（😀）在 CP936 中没有定义，必须在写入前失败。
        let content = "前面 OK 然后不对：😀 结尾";
        let err = encode(content, TextEncoding::Gbk).unwrap_err();
        match err {
            DocumentError::UnencodableContent {
                character,
                byte_offset,
            } => {
                assert_eq!(character, '😀');
                // 偏移必须是字符边界，且精确指向首个不可表示字符。
                assert!(content.is_char_boundary(byte_offset));
                assert_eq!(&content[byte_offset..], "😀 结尾");
            }
            other => panic!("expected UnencodableContent, got {other:?}"),
        }
    }
}
