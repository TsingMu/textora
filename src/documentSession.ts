import type {
  DocumentDescriptor,
  DocumentErrorCode,
  LineEnding,
  TextEncoding,
} from "./platform";

export type OpenStatus =
  | "idle"
  | "loading"
  | "awaiting-discard-confirm"
  | "error";

export type DocumentSession = {
  id: string;
  path: string | null;
  displayName: string;
  content: string;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  readOnly: boolean;
  isDirty: boolean;
  openStatus: OpenStatus;
  openErrorCode: DocumentErrorCode | null;
};

export function createNewDocument(id = "untitled-1"): DocumentSession {
  return {
    id,
    path: null,
    displayName: "Untitled",
    content: "",
    encoding: { utf8: { bom: false } },
    lineEnding: "lf",
    readOnly: false,
    isDirty: false,
    openStatus: "idle",
    openErrorCode: null,
  };
}

export function updateDocumentContent(
  document: DocumentSession,
  content: string,
): DocumentSession {
  if (content === document.content) {
    return document;
  }
  return { ...document, content, isDirty: true };
}

/// 已在打开流程中时不再触发新流程，避免重复读取。
export function requestOpen(document: DocumentSession): DocumentSession {
  if (document.openStatus === "loading" || document.openStatus === "awaiting-discard-confirm") {
    return document;
  }
  if (document.isDirty) {
    return { ...document, openStatus: "awaiting-discard-confirm", openErrorCode: null };
  }
  return { ...document, openStatus: "loading", openErrorCode: null };
}

export function cancelOpen(document: DocumentSession): DocumentSession {
  return { ...document, openStatus: "idle", openErrorCode: null };
}

export function startLoading(document: DocumentSession): DocumentSession {
  return { ...document, openStatus: "loading", openErrorCode: null };
}

export function failOpen(
  document: DocumentSession,
  code: DocumentErrorCode,
): DocumentSession {
  return { ...document, openStatus: "error", openErrorCode: code };
}

/// 用打开结果原子替换当前会话。调用方应保证此时已取得完整内容，
/// 以免出现内容被部分覆盖的中间态。
export function commitOpenedDocument(
  document: DocumentSession,
  descriptor: DocumentDescriptor,
  content: string,
): DocumentSession {
  return {
    ...document,
    id: descriptor.id,
    path: descriptor.path,
    displayName: descriptor.displayName,
    content,
    encoding: descriptor.encoding,
    lineEnding: descriptor.lineEnding,
    readOnly: descriptor.readOnly,
    isDirty: false,
    openStatus: "idle",
    openErrorCode: null,
  };
}
