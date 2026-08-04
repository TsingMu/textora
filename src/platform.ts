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
  | "save-conflict-content-changed"
  | "save-conflict-target-missing"
  | "save-failed"
  | "unknown-document"
  | "invalid-file-name"
  | "missing-grant"
  | "grant-mismatch";

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

/** 保存格式选择（首次保存/另存为时取自主界面右下角设置）。 */
export type EncodingChoice = "utf8" | "utf8-bom" | "gbk";
export type LineEndingChoice = "lf" | "crlf";

export type SaveDirectoryGrant = {
  id: string;
  displayName: string;
};

export type SaveAsDraft = {
  fileName: string;
  directory: SaveDirectoryGrant | null;
};

export type TargetPreview = {
  exists: boolean;
  isCurrentPath: boolean;
};

/** 取得内嵌另存为面板的可信默认文件名与可选默认目录授权。 */
export async function prepareSaveAs(
  documentId: string | null,
): Promise<SaveAsDraft> {
  return invoke<SaveAsDraft>("prepare_save_as", { documentId });
}

/** 由 Rust 显示系统目录选择器；取消返回 null，前端从不接收真实路径。 */
export async function pickSaveDirectory(
  documentId: string | null,
): Promise<SaveDirectoryGrant | null> {
  return invoke<SaveDirectoryGrant | null>("pick_save_directory", {
    documentId,
  });
}

/** 只读预览授权目录与文件名组成的目标。 */
export async function previewSaveTarget(options: {
  id: string | null;
  directoryId: string;
  fileName: string;
}): Promise<TargetPreview> {
  return invoke<TargetPreview>("preview_save_target", {
    documentId: options.id,
    directoryId: options.directoryId,
    fileName: options.fileName,
  });
}

/**
 * 使用 Rust 发放的目录授权完成另存为。内容继续走 Raw body；Unicode 文件名按 UTF-8
 * percent-encoding 放入 header，前端不能提交路径。
 */
export async function saveAsAt(options: {
  id: string | null;
  directoryId: string;
  fileName: string;
  encoding: EncodingChoice;
  lineEnding: LineEndingChoice;
  content: string;
}): Promise<DocumentDescriptor> {
  const body = new TextEncoder().encode(options.content);
  const headers: Record<string, string> = {
    "textora-directory-id": options.directoryId,
    "textora-file-name": encodeURIComponent(options.fileName),
    "textora-encoding": options.encoding,
    "textora-line-ending": options.lineEnding,
  };
  if (options.id !== null) {
    headers["textora-document-id"] = options.id;
  }
  return invoke<DocumentDescriptor>("save_document_as_at", body, { headers });
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

/**
 * 取消当前内容变化冲突。后端清除待解决冲突状态，不执行文件 I/O。
 */
export async function cancelConflict(id: string): Promise<void> {
  return invoke<void>("cancel_conflict", { id });
}

/**
 * 从后端可信路径重新加载磁盘内容以解决冲突。返回更新后的描述符；内容随后经
 * `readDocumentContent` 以原始二进制取回。读取失败时后端保留冲突状态。
 */
export async function reloadFromConflict(
  id: string,
): Promise<DocumentDescriptor> {
  return invoke<DocumentDescriptor>("reload_from_conflict", { id });
}

/**
 * 用户明确确认后，以冲突时保留的完整编辑快照覆盖确认后的最新磁盘基线。
 * 后端重新观测目标取得基线并复用全部文件安全保护。确认后目标再次变化时覆盖被拒绝，
 * 冲突保持待解决。
 */
export async function forceOverwrite(
  id: string,
): Promise<DocumentDescriptor> {
  return invoke<DocumentDescriptor>("force_overwrite", { id });
}

/**
 * 检查当前文档的可信路径文件是否仍存在。只做 metadata 调用，不读取内容。
 * 未知或过期 id 返回 true（不触发缺失提示）。
 */
export async function checkTargetExists(id: string): Promise<boolean> {
  return invoke<boolean>("check_target_exists", { id });
}

/**
 * 关闭文档：清除后端活动文档关联与冲突状态。用于「保留」（解除路径关联）和
 * 「不保留」（关闭文档）两个分支。未知 id 为安全 no-op。
 */
export async function closeDocument(id: string): Promise<void> {
  return invoke<void>("close_document", { id });
}

/**
 * 在未保存关闭确认完成后请求正常退出。后端经 `AppHandle::exit` 触发程序化退出，
 * 该路径不被用户退出保护再次拦截。失败时应用保持运行。
 */
export async function requestAppExit(): Promise<void> {
  try {
    await invoke<void>("request_app_exit");
  } catch {
    // 退出失败时保持运行，让用户重试。
  }
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
  "save-conflict-content-changed",
  "save-conflict-target-missing",
  "save-failed",
  "unknown-document",
  "invalid-file-name",
  "missing-grant",
  "grant-mismatch",
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

/** 把保存格式选择映射为面向用户的编码名称（与 `encodingDisplayName` 保持一致）。 */
export function encodingChoiceDisplayName(choice: EncodingChoice): string {
  switch (choice) {
    case "utf8":
      return "UTF-8";
    case "utf8-bom":
      return "UTF-8 (BOM)";
    case "gbk":
      return "GBK";
  }
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

/** 重新加载冲突磁盘版本时使用读取侧文案，同时保留过期请求的明确提示。 */
export function describeConflictReloadError(
  error: DocumentCommandError,
): string {
  switch (error.code) {
    case "file-too-large":
    case "unsupported-encoding":
    case "changed-during-read":
    case "read-failed":
      return describeOpenError(error.code);
    case "unknown-document":
      return "This conflict is no longer active. Cancel it or save again to refresh the document state.";
    default:
      return "The disk version could not be reloaded. Your edits are still preserved.";
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
    case "save-conflict-content-changed":
      return "The file changed on disk since it was opened. Saving was refused to protect both versions.";
    case "save-conflict-target-missing":
      return "The file no longer exists on disk. Saving was refused to protect the current content.";
    case "unknown-document":
      return "This document is no longer associated with an open file.";
    case "invalid-file-name":
      return "Enter a valid file name without path separators.";
    case "missing-grant":
    case "grant-mismatch":
      return "The save location authorization expired. Choose the location again.";
    case "unsupported-encoding":
      return "The edited content could not be encoded for saving.";
    case "changed-during-read":
      return "The file changed while the save request was being prepared.";
    case "read-failed":
    case "save-failed":
      return "The file could not be saved.";
  }
}
