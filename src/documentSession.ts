import type {
  DocumentCommandError,
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

export type SaveStatus = "idle" | "saving" | "error";

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
  saveStatus: SaveStatus;
  saveError: DocumentCommandError | null;
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
    saveStatus: "idle",
    saveError: null,
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
    saveStatus: "idle",
    saveError: null,
  };
}

/// 任意打开或保存流程进行中时视为忙碌，禁止并发文件操作。
export function isBusy(document: DocumentSession): boolean {
  return (
    document.openStatus === "loading" ||
    document.openStatus === "awaiting-discard-confirm" ||
    document.saveStatus === "saving"
  );
}

/// 请求普通保存。仅当已打开（有路径）、已修改、且当前不忙碌时进入保存态；
/// 新建文档、未修改或忙碌时返回原会话（入口应由调用方禁用）。
export function requestSave(document: DocumentSession): DocumentSession {
  if (
    document.path === null ||
    !document.isDirty ||
    isBusy(document) ||
    document.readOnly
  ) {
    return document;
  }
  return { ...document, saveStatus: "saving", saveError: null };
}

export function failSave(
  document: DocumentSession,
  error: DocumentCommandError,
): DocumentSession {
  return { ...document, saveStatus: "error", saveError: error };
}

export function cancelSave(document: DocumentSession): DocumentSession {
  return { ...document, saveStatus: "idle", saveError: null };
}

/// 保存成功：清除未保存标记与保存状态。内容保持为用户当前所见（与提交一致）。
export function commitSavedDocument(
  document: DocumentSession,
  descriptor: DocumentDescriptor,
): DocumentSession {
  return {
    ...document,
    isDirty: false,
    saveStatus: "idle",
    saveError: null,
    readOnly: descriptor.readOnly,
  };
}
