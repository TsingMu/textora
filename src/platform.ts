import { invoke } from "@tauri-apps/api/core";

export type HealthStatus = {
  service: string;
  version: string;
};

export type TextEncoding =
  | { utf8: { bom: boolean } }
  | "gbk";

export type LineEnding = "lf" | "crlf" | "mixed";

export type FileFingerprint = {
  sizeBytes: number;
  sha256: string;
};

export type DocumentDescriptor = {
  id: string;
  path: string;
  displayName: string;
  byteCount: number;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  fingerprint: FileFingerprint;
  readOnly: boolean;
};

export type DocumentErrorCode =
  | "file-too-large"
  | "unsupported-encoding"
  | "changed-during-read"
  | "read-failed"
  | "read-only"
  | "mixed-line-ending"
  | "unencodable-content"
  | "encoding-ambiguous"
  | "save-conflict"
  | "save-failed"
  | "unknown-document";

export type DocumentCommandError = {
  code: DocumentErrorCode;
  message: string;
  character?: string;
  byteOffset?: number;
};

/** 兼容旧调用方的别名；打开与保存共用同一错误信封。 */
export type DocumentOpenError = DocumentCommandError;

export async function checkBackendHealth(): Promise<HealthStatus> {
  return invoke<HealthStatus>("health_check");
}

/**
 * 请求 Rust 显示系统文件对话框，并打开用户实际选择的单个文件。取消返回 `null`。
 * 前端不接收或提交任意路径。
 */
export async function selectAndOpenDocument(): Promise<DocumentDescriptor | null> {
  return invoke<DocumentDescriptor | null>("select_and_open_document");
}

/**
 * 以原始二进制取回最近一次打开的文档内容（解码后的 UTF-8 字节）。文档 ID 必须与
 * `openDocument` 返回的一致；取回后后端缓冲即清空。
 */
export async function readDocumentContent(id: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("read_document_content", { id });
}

/**
 * 把当前内容以原始二进制保存回已打开文档的原路径。内容经 Raw body 传输，文档 id 经
 * `textora-document-id` header 传输——既不编码为 JSON 数字数组，也不作为大字符串。
 * 成功返回更新后的描述符（含新的指纹与字节数）。
 */
export async function saveDocument(
  id: string,
  content: string,
): Promise<DocumentDescriptor> {
  const body = new TextEncoder().encode(content);
  return invoke<DocumentDescriptor>("save_document", body, {
    headers: { "textora-document-id": id },
  });
}

/** 保存格式选择（首次保存/另存为时由用户在应用内界面选择）。 */
export type EncodingChoice = "utf8" | "utf8-bom" | "gbk";
export type LineEndingChoice = "lf" | "crlf";

/**
 * 另存为 / 首次保存。系统保存对话框由 Rust 发起，前端只提交格式选择（header）与二进制
 * UTF-8 内容（Raw body）；目标路径不出现在前端。`id` 为已打开文档的后端 id，省略（null）
 * 表示 Untitled 首次保存。用户在系统对话框取消时返回 `null`，成功返回新描述符。
 */
export async function saveAs(options: {
  id: string | null;
  encoding: EncodingChoice;
  lineEnding: LineEndingChoice;
  content: string;
}): Promise<DocumentDescriptor | null> {
  const body = new TextEncoder().encode(options.content);
  const headers: Record<string, string> = {
    "textora-encoding": options.encoding,
    "textora-line-ending": options.lineEnding,
  };
  if (options.id !== null) {
    headers["textora-document-id"] = options.id;
  }
  return invoke<DocumentDescriptor | null>("save_document_as", body, { headers });
}

/** 将会话当前编码映射为格式选择的默认值。 */
export function encodingToChoice(encoding: TextEncoding): EncodingChoice {
  if (typeof encoding === "string") {
    return "gbk";
  }
  return encoding.utf8.bom ? "utf8-bom" : "utf8";
}

/** 将会话当前换行映射为格式选择的默认值（Mixed 归 LF，需用户在界面确认）。 */
export function lineEndingToChoice(lineEnding: LineEnding): LineEndingChoice {
  return lineEnding === "crlf" ? "crlf" : "lf";
}

const COMMAND_ERROR_CODES: readonly DocumentErrorCode[] = [
  "file-too-large",
  "unsupported-encoding",
  "changed-during-read",
  "read-failed",
  "read-only",
  "mixed-line-ending",
  "unencodable-content",
  "encoding-ambiguous",
  "save-conflict",
  "save-failed",
  "unknown-document",
];

/** 判定值是否为后端稳定错误信封；打开与保存共用。 */
export function isDocumentCommandError(
  value: unknown,
): value is DocumentCommandError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    code?: unknown;
    message?: unknown;
    character?: unknown;
    byteOffset?: unknown;
  };
  return (
    typeof candidate.code === "string" &&
    (COMMAND_ERROR_CODES as readonly string[]).includes(candidate.code) &&
    typeof candidate.message === "string" &&
    (candidate.character === undefined ||
      typeof candidate.character === "string") &&
    (candidate.byteOffset === undefined ||
      typeof candidate.byteOffset === "number")
  );
}

export function encodingDisplayName(encoding: TextEncoding): string {
  if (typeof encoding === "string") {
    return "GBK";
  }
  return encoding.utf8.bom ? "UTF-8 (BOM)" : "UTF-8";
}

export function lineEndingDisplayName(lineEnding: LineEnding): string {
  switch (lineEnding) {
    case "lf":
      return "LF";
    case "crlf":
      return "CRLF";
    case "mixed":
      return "Mixed";
  }
}

/**
 * 把后端稳定错误代码映射为面向用户的简短说明，不暴露 Rust 内部文本。
 * 打开与保存共用同一映射。
 */
export function describeOpenError(code: DocumentErrorCode): string {
  switch (code) {
    case "file-too-large":
      return "This file is larger than 50 MB and cannot be opened yet.";
    case "unsupported-encoding":
      return "This file is not valid UTF-8 or strict GBK/CP936.";
    case "changed-during-read":
      return "The file changed while being read. Please try again.";
    case "read-failed":
      return "The file could not be read.";
    default:
      return "The file could not be opened.";
  }
}

/** 保存错误使用独立文案，并保留后端提供的安全定位信息。 */
export function describeSaveError(error: DocumentCommandError): string {
  switch (error.code) {
    case "file-too-large":
      return "The edited content is larger than 50 MB and cannot be saved.";
    case "read-only":
      return "This document is read-only and cannot be saved.";
    case "mixed-line-ending":
      return "Line endings are mixed. Choose LF or CRLF before saving.";
    case "unencodable-content": {
      const codePoint = error.character?.codePointAt(0);
      if (codePoint !== undefined && error.byteOffset !== undefined) {
        const unicode = `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
        return `${unicode} at UTF-8 byte offset ${error.byteOffset} cannot be represented in the file's encoding.`;
      }
      return "Some characters cannot be represented in the file's encoding.";
    }
    case "encoding-ambiguous":
      return "Saving as GBK would not reopen with the same encoding and content. Save as UTF-8 instead.";
    case "save-conflict":
      return "The file changed on disk since it was opened. Saving was refused.";
    case "unknown-document":
      return "This document is no longer associated with an open file.";
    case "unsupported-encoding":
      return "The edited content could not be encoded for saving.";
    case "changed-during-read":
      return "The file changed while the save request was being prepared.";
    case "read-failed":
    case "save-failed":
      return "The file could not be saved.";
  }
}
