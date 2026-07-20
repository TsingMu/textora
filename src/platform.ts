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
  | "read-failed";

export type DocumentOpenError = {
  code: DocumentErrorCode;
  message: string;
};

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

const OPEN_ERROR_CODES: readonly DocumentErrorCode[] = [
  "file-too-large",
  "unsupported-encoding",
  "changed-during-read",
  "read-failed",
];

export function isOpenError(value: unknown): value is DocumentOpenError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && (OPEN_ERROR_CODES as readonly string[]).includes(code);
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
  }
}
