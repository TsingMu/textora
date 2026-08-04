import { useEffect, useRef, useState } from "react";
import "./App.css";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import {
  cancelOpen,
  cancelSave,
  commitOpenedDocument,
  commitSavedAs,
  commitSavedDocument,
  createNewDocument,
  failOpen,
  failSave,
  isBusy,
  requestOpen,
  requestSave,
  startLoading,
  updateDocumentContent,
  type DocumentSession,
} from "./documentSession";
import { Editor } from "./Editor";
import {
  cancelConflict,
  checkBackendHealth,
  checkTargetExists,
  closeDocument,
  describeConflictReloadError,
  describeOpenError,
  describeSaveError,
  encodingChoiceDisplayName,
  encodingToChoice,
  forceOverwrite,
  isDocumentCommandError,
  lineEndingDisplayName,
  lineEndingToChoice,
  readDocumentContent,
  reloadFromConflict,
  requestAppExit,
  saveAs,
  saveDocument,
  selectAndOpenDocument,
  type DocumentCommandError,
  type EncodingChoice,
  type HealthStatus,
  type LineEndingChoice,
} from "./platform";

const initialDocument = createNewDocument();
type ConflictOperationStatus = "idle" | "canceling" | "reloading" | "overwriting";
type FileMissingOperationStatus = "idle" | "keeping" | "discarding";
type CloseKind = "window" | "app-exit";
type CloseIntent = {
  documentId: string;
  content: string;
  kind: CloseKind;
};

function App() {
  const [session, setSession] = useState<DocumentSession>(initialDocument);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [conflictOperation, setConflictOperation] = useState<{
    status: ConflictOperationStatus;
    errorMessage: string | null;
  }>({ status: "idle", errorMessage: null });
  const [saveAsDialog, setSaveAsDialog] = useState<{
    open: boolean;
    encoding: EncodingChoice;
    lineEnding: LineEndingChoice;
  }>({ open: false, encoding: "utf8", lineEnding: "lf" });
  const [fileMissingPending, setFileMissingPending] = useState(false);
  const [fileMissingOperation, setFileMissingOperation] = useState<{
    status: FileMissingOperationStatus;
    errorMessage: string | null;
  }>({ status: "idle", errorMessage: null });
  const [closeConfirmPending, setCloseConfirmPending] = useState(false);
  const [closeConfirmError, setCloseConfirmError] = useState<string | null>(null);
  const [saveFormat, setSaveFormat] = useState<{
    encoding: EncodingChoice;
    lineEnding: LineEndingChoice;
  }>({
    encoding: encodingToChoice(initialDocument.encoding),
    lineEnding: lineEndingToChoice(initialDocument.lineEnding),
  });
  const [formatSettingsOpen, setFormatSettingsOpen] = useState(false);
  const [formatDraft, setFormatDraft] = useState<{
    encoding: EncodingChoice;
    lineEnding: LineEndingChoice;
  }>(saveFormat);
  const sessionRef = useRef(session);
  const fileMissingPendingRef = useRef(fileMissingPending);
  const fileMissingResolvingRef = useRef(false);
  const targetCheckRevisionRef = useRef(0);
  const targetCheckInFlightRef = useRef<{
    revision: number;
    documentId: string;
    path: string;
  } | null>(null);
  const busyRef = useRef(false);
  const closeConfirmPendingRef = useRef(false);
  const closeIntentRef = useRef<CloseIntent | null>(null);
  const closeAuthorizationRef = useRef<{
    validDocumentIds: readonly string[];
  } | null>(null);
  sessionRef.current = session;
  fileMissingPendingRef.current = fileMissingPending;

  useEffect(() => {
    let active = true;

    checkBackendHealth()
      .then((status) => {
        if (active) setHealth(status);
      })
      .catch(() => {
        if (active) setBackendUnavailable(true);
      });

    return () => {
      active = false;
    };
  }, []);

  // 文档载入/另存/重载/覆盖导致会话格式变化时，把右下角格式设置重置为当前文档格式；
  // 用户在此期间的覆盖会保留到下一次文档格式变化。若弹层正打开，同时丢弃草稿并关闭弹层，
  // 避免旧文档的草稿在切换后被提交、覆盖新文档格式。
  useEffect(() => {
    const documentFormat = {
      encoding: encodingToChoice(session.encoding),
      lineEnding: lineEndingToChoice(session.lineEnding),
    };
    setSaveFormat(documentFormat);
    setFormatDraft(documentFormat);
    setFormatSettingsOpen(false);
  }, [session.id, session.encoding, session.lineEnding]);

  // 窗口关闭拦截 + 聚焦缺失检查（合并到同一 effect 以共享一次 dynamic import）。
  useEffect(() => {
    let cancelled = false;
    let unlistenClose: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    const checkCurrentTarget = () => {
      const current = sessionRef.current;
      if (
        current.path === null ||
        isBusy(current) ||
        current.saveStatus === "error" ||
        fileMissingPendingRef.current
      ) {
        return;
      }

      const existing = targetCheckInFlightRef.current;
      if (
        existing?.documentId === current.id &&
        existing.path === current.path
      ) {
        return;
      }

      const revision = targetCheckRevisionRef.current + 1;
      targetCheckRevisionRef.current = revision;
      const request = {
        revision,
        documentId: current.id,
        path: current.path,
      };
      targetCheckInFlightRef.current = request;

      void checkTargetExists(request.documentId)
        .then((exists) => {
          if (
            cancelled ||
            targetCheckInFlightRef.current?.revision !== request.revision
          ) {
            return;
          }
          targetCheckInFlightRef.current = null;
          const latest = sessionRef.current;
          if (
            exists ||
            latest.id !== request.documentId ||
            latest.path !== request.path ||
            isBusy(latest) ||
            latest.saveStatus === "error" ||
            fileMissingPendingRef.current
          ) {
            return;
          }
          fileMissingPendingRef.current = true;
          setFileMissingOperation({ status: "idle", errorMessage: null });
          setFileMissingPending(true);
        })
        .catch(() => {
          if (targetCheckInFlightRef.current?.revision === request.revision) {
            targetCheckInFlightRef.current = null;
          }
        });
    };

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (cancelled) return;

        const stopListeningClose = await getCurrentWindow().onCloseRequested(
          (event: CloseRequestedEvent) => {
            const current = sessionRef.current;
            const authorization = closeAuthorizationRef.current;
            if (authorization !== null) {
              closeAuthorizationRef.current = null;
              if (authorization.validDocumentIds.includes(current.id)) {
                return;
              }
              event.preventDefault();
              return;
            }
            if (
              busyRef.current ||
              closeConfirmPendingRef.current ||
              closeIntentRef.current !== null
            ) {
              event.preventDefault();
              return;
            }
            if (!current.isDirty) {
              return;
            }
            event.preventDefault();
            closeIntentRef.current = {
              documentId: current.id,
              content: current.content,
              kind: "window",
            };
            closeConfirmPendingRef.current = true;
            setCloseConfirmError(null);
            setCloseConfirmPending(true);
          },
        );
        if (cancelled) {
          stopListeningClose();
          return;
        }
        unlistenClose = stopListeningClose;

        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        const stopListeningExit = await listen(
          "textora-app-exit-requested",
          () => {
            const current = sessionRef.current;
            const existing = closeIntentRef.current;
            if (existing !== null) {
              // 归并：已有窗口关闭或退出意图时统一升级为应用退出，不重复提示，
              // 也不能因取消其中一个事件而由另一个绕过保护。
              if (existing.kind !== "app-exit") {
                closeIntentRef.current = { ...existing, kind: "app-exit" };
              }
              return;
            }
            if (closeConfirmPendingRef.current || busyRef.current) {
              // 忙碌或已有提示时安全阻止（Rust 已 prevent_exit），不叠加第二个提示。
              return;
            }
            if (!current.isDirty) {
              // 未修改：完成正常退出。
              void requestAppExit();
              return;
            }
            closeIntentRef.current = {
              documentId: current.id,
              content: current.content,
              kind: "app-exit",
            };
            closeConfirmPendingRef.current = true;
            setCloseConfirmError(null);
            setCloseConfirmPending(true);
          },
        );
        if (cancelled) {
          stopListeningExit();
          return;
        }
        unlistenExit = stopListeningExit;

        const stopListeningFocus = await getCurrentWindow().onFocusChanged(
          ({ payload: focused }) => {
            if (focused && !cancelled) {
              checkCurrentTarget();
            }
          },
        );
        if (cancelled) {
          stopListeningFocus();
          return;
        }
        unlistenFocus = stopListeningFocus;
      } catch {
        // 非 Tauri 环境不设置监听。
      }
    })();

    return () => {
      cancelled = true;
      targetCheckRevisionRef.current += 1;
      targetCheckInFlightRef.current = null;
      unlistenClose?.();
      unlistenExit?.();
      unlistenFocus?.();
    };
  }, []);

  function clearCloseIntent() {
    closeIntentRef.current = null;
    closeAuthorizationRef.current = null;
  }

  async function executeAuthorizedClose(
    kind: CloseKind,
    validDocumentIds: readonly string[],
  ) {
    closeIntentRef.current = null;
    if (kind === "app-exit") {
      // 应用退出不经窗口关闭授权，直接请求程序化退出；失败时 requestAppExit 自身保留运行。
      await requestAppExit();
      return;
    }
    const authorization = { validDocumentIds };
    closeAuthorizationRef.current = authorization;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      if (closeAuthorizationRef.current === authorization) {
        closeAuthorizationRef.current = null;
      }
    }
  }

  async function handleCloseSave() {
    const intent = closeIntentRef.current;
    if (intent === null || intent.documentId !== sessionRef.current.id) {
      clearCloseIntent();
      setCloseConfirmPending(false);
      closeConfirmPendingRef.current = false;
      return;
    }
    setCloseConfirmPending(false);
    closeConfirmPendingRef.current = false;
    const current = sessionRef.current;

    if (current.path !== null && !current.readOnly) {
      setSession((s) => ({ ...s, saveStatus: "saving", saveError: null }));
      try {
        const descriptor = await saveDocument(intent.documentId, intent.content);
        setSession((s) => commitSavedDocument(s, descriptor));
        await executeAuthorizedClose(intent.kind, [intent.documentId]);
      } catch (err) {
        clearCloseIntent();
        const error: DocumentCommandError = isDocumentCommandError(err)
          ? err
          : { code: "save-failed", message: "save request failed" };
        if (error.code === "save-conflict-content-changed") {
          setConflictOperation({ status: "idle", errorMessage: null });
          setSession((s) => failSave(s, error));
          return;
        }
        if (error.code === "save-conflict-target-missing") {
          targetCheckRevisionRef.current += 1;
          targetCheckInFlightRef.current = null;
          fileMissingPendingRef.current = true;
          setFileMissingOperation({ status: "idle", errorMessage: null });
          setFileMissingPending(true);
          return;
        }
        setSession((s) => failSave(s, error));
      }
    } else {
      openSaveAsDialog();
    }
  }

  async function handleCloseDiscard() {
    const intent = closeIntentRef.current;
    if (intent === null || intent.documentId !== sessionRef.current.id) {
      clearCloseIntent();
      setCloseConfirmPending(false);
      closeConfirmPendingRef.current = false;
      return;
    }
    setCloseConfirmPending(false);
    closeConfirmPendingRef.current = false;
    if (intent.documentId !== "untitled-1") {
      try {
        await closeDocument(intent.documentId);
      } catch {
        setCloseConfirmError(
          "The document could not be closed safely. Please try again.",
        );
        closeConfirmPendingRef.current = true;
        setCloseConfirmPending(true);
        return;
      }
    }
    await executeAuthorizedClose(intent.kind, [intent.documentId]);
  }

  function handleCloseCancel() {
    clearCloseIntent();
    setCloseConfirmError(null);
    setCloseConfirmPending(false);
    closeConfirmPendingRef.current = false;
  }

  async function handleFileMissingKeep() {
    if (!fileMissingPending || fileMissingResolvingRef.current) {
      return;
    }
    const documentId = session.id;
    fileMissingResolvingRef.current = true;
    setFileMissingOperation({ status: "keeping", errorMessage: null });
    try {
      await closeDocument(documentId);
    } catch {
      fileMissingResolvingRef.current = false;
      setFileMissingOperation({
        status: "idle",
        errorMessage:
          "The file could not be detached from this session. Please try again.",
      });
      return;
    }
    setSession((current) => {
      if (current.id !== documentId) return current;
      return {
        ...current,
        path: null,
        isDirty: true,
        saveStatus: "idle",
        saveError: null,
      };
    });
    fileMissingResolvingRef.current = false;
    fileMissingPendingRef.current = false;
    setFileMissingPending(false);
    setFileMissingOperation({ status: "idle", errorMessage: null });
  }

  async function handleFileMissingDiscard() {
    if (!fileMissingPending || fileMissingResolvingRef.current) {
      return;
    }
    const documentId = session.id;
    fileMissingResolvingRef.current = true;
    setFileMissingOperation({ status: "discarding", errorMessage: null });
    try {
      await closeDocument(documentId);
    } catch {
      fileMissingResolvingRef.current = false;
      setFileMissingOperation({
        status: "idle",
        errorMessage:
          "The file could not be closed. Your content is still preserved.",
      });
      return;
    }
    setSession((current) => {
      if (current.id !== documentId) return current;
      return createNewDocument();
    });
    fileMissingResolvingRef.current = false;
    fileMissingPendingRef.current = false;
    setFileMissingPending(false);
    setFileMissingOperation({ status: "idle", errorMessage: null });
  }

  useEffect(() => {
    if (!fileMissingPending || fileMissingOperation.status !== "idle") {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void handleFileMissingKeep();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [fileMissingPending, fileMissingOperation.status, session.id]);

  async function runOpenPipeline() {
    setSession((current) => startLoading(current));

    try {
      const descriptor = await selectAndOpenDocument();
      if (descriptor === null) {
        setSession((current) => cancelOpen(current));
        return;
      }
      const buffer = await readDocumentContent(descriptor.id);
      const content = new TextDecoder().decode(buffer);
      setSession((current) => commitOpenedDocument(current, descriptor, content));
    } catch (err) {
      const code = isDocumentCommandError(err) ? err.code : "read-failed";
      setSession((current) => failOpen(current, code));
    }
  }

  async function runSavePipeline(id: string, content: string) {
    try {
      const descriptor = await saveDocument(id, content);
      setConflictOperation({ status: "idle", errorMessage: null });
      setSession((current) => commitSavedDocument(current, descriptor));
    } catch (err) {
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "save request failed" };
      if (error.code === "save-conflict-content-changed") {
        setConflictOperation({ status: "idle", errorMessage: null });
      }
      if (error.code === "save-conflict-target-missing") {
        // 文件已删除：进入保留/关闭流程，不走通用保存失败。
        targetCheckRevisionRef.current += 1;
        targetCheckInFlightRef.current = null;
        fileMissingPendingRef.current = true;
        setFileMissingOperation({ status: "idle", errorMessage: null });
        setFileMissingPending(true);
        return;
      }
      setSession((current) => failSave(current, error));
    }
  }

  async function runSaveAsPipeline(
    id: string | null,
    encoding: EncodingChoice,
    lineEnding: LineEndingChoice,
    content: string,
  ) {
    const closeIntent = closeIntentRef.current;
    try {
      const descriptor = await saveAs({ id, encoding, lineEnding, content });
      if (descriptor === null) {
        // 用户在系统保存对话框取消；内容、关联与未保存状态保持不变。
        clearCloseIntent();
        setSession((current) => cancelSave(current));
        return;
      }
      setSession((current) => commitSavedAs(current, descriptor));
      if (closeIntent !== null) {
        await executeAuthorizedClose(closeIntent.kind, [
          closeIntent.documentId,
          descriptor.id,
        ]);
      }
    } catch (err) {
      clearCloseIntent();
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "save request failed" };
      setSession((current) => failSave(current, error));
    }
  }

  function openSaveAsDialog() {
    setSaveAsDialog({
      open: true,
      encoding: encodingToChoice(session.encoding),
      lineEnding: lineEndingToChoice(session.lineEnding),
    });
  }

  function handleOpenClick() {
    const next = requestOpen(session);
    if (next === session) {
      return;
    }
    setSession(next);
    if (next.openStatus === "loading") {
      void runOpenPipeline();
    }
  }

  function handleSaveClick() {
    // 新建文档（无路径）经格式选择进入首次保存流程；已打开文档走普通原路径保存。
    if (session.path === null) {
      if (isBusy(session)) {
        return;
      }
      openSaveAsDialog();
      return;
    }
    const next = requestSave(session);
    if (next === session) {
      return;
    }
    setSession(next);
    if (next.saveStatus === "saving") {
      void runSavePipeline(next.id, next.content);
    }
  }

  function handleSaveAsClick() {
    if (isBusy(session)) {
      return;
    }
    openSaveAsDialog();
  }

  function handleSaveAsConfirm() {
    const { encoding, lineEnding } = saveAsDialog;
    const id = session.path !== null ? session.id : null;
    const content = session.content;
    setSaveAsDialog((current) => ({ ...current, open: false }));
    setSession((current) => ({ ...current, saveStatus: "saving", saveError: null }));
    void runSaveAsPipeline(id, encoding, lineEnding, content);
  }

  function handleSaveAsCancel() {
    if (closeIntentRef.current !== null) {
      clearCloseIntent();
    }
    setSaveAsDialog((current) => ({ ...current, open: false }));
  }

  function openFormatSettings() {
    setFormatDraft(saveFormat);
    setFormatSettingsOpen(true);
  }

  function cancelFormatSettings() {
    // 取消丢弃草稿，不改动 saveFormat；下次打开会重新以 saveFormat 起草。
    setFormatSettingsOpen(false);
  }

  function confirmFormatSettings() {
    setSaveFormat(formatDraft);
    setFormatSettingsOpen(false);
  }

  function handleConfirmDiscard() {
    setSession((current) => startLoading(current));
    void runOpenPipeline();
  }

  function handleConfirmCancel() {
    setSession((current) => cancelOpen(current));
  }

  function handleDismissOpenError() {
    setSession((current) => cancelOpen(current));
  }

  function handleDismissSaveError() {
    setSession((current) => cancelSave(current));
  }

  const conflictPending =
    session.saveStatus === "error" &&
    session.saveError?.code === "save-conflict-content-changed";

  async function handleConflictReload() {
    if (!conflictPending || conflictOperation.status !== "idle") {
      return;
    }
    const documentId = session.id;
    setConflictOperation({ status: "reloading", errorMessage: null });
    try {
      const descriptor = await reloadFromConflict(documentId);
      const buffer = await readDocumentContent(descriptor.id);
      const content = new TextDecoder().decode(buffer);
      setSession((current) => {
        if (
          current.id !== documentId ||
          current.saveError?.code !== "save-conflict-content-changed"
        ) {
          return current;
        }
        return commitOpenedDocument(current, descriptor, content);
      });
      setConflictOperation({ status: "idle", errorMessage: null });
    } catch (err) {
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "reload failed" };
      setConflictOperation({
        status: "idle",
        errorMessage: describeConflictReloadError(error),
      });
    }
  }

  async function handleConflictCancel() {
    if (!conflictPending || conflictOperation.status !== "idle") {
      return;
    }
    const documentId = session.id;
    setConflictOperation({ status: "canceling", errorMessage: null });
    try {
      await cancelConflict(documentId);
    } catch {
      setConflictOperation({
        status: "idle",
        errorMessage: "The conflict could not be cancelled. Please try again.",
      });
      return;
    }
    setSession((current) => {
      if (
        current.id !== documentId ||
        current.saveError?.code !== "save-conflict-content-changed"
      ) {
        return current;
      }
      return cancelSave(current);
    });
    setConflictOperation({ status: "idle", errorMessage: null });
  }

  async function handleConflictOverwrite() {
    if (!conflictPending || conflictOperation.status !== "idle") {
      return;
    }
    const documentId = session.id;
    setConflictOperation({ status: "overwriting", errorMessage: null });
    try {
      const descriptor = await forceOverwrite(documentId);
      setSession((current) => {
        if (
          current.id !== documentId ||
          current.saveError?.code !== "save-conflict-content-changed"
        ) {
          return current;
        }
        return commitSavedDocument(current, descriptor);
      });
      setConflictOperation({ status: "idle", errorMessage: null });
    } catch (err) {
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "force-overwrite failed" };
      setConflictOperation({
        status: "idle",
        errorMessage: describeSaveError(error),
      });
    }
  }

  useEffect(() => {
    if (!conflictPending || conflictOperation.status !== "idle") {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void handleConflictCancel();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [conflictPending, conflictOperation.status, session.id]);

  // 关闭确认期间 Escape 等价于取消关闭。
  useEffect(() => {
    if (!closeConfirmPending) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCloseCancel();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closeConfirmPending]);

  const busy =
    isBusy(session) || saveAsDialog.open || conflictPending || fileMissingPending || closeConfirmPending;
  busyRef.current = busy;
  const editorLocked =
    session.openStatus === "loading" ||
    session.saveStatus === "saving" ||
    conflictPending ||
    fileMissingPending ||
    closeConfirmPending;
  const canSave =
    !session.readOnly && !busy && (session.path === null || session.isDirty);
  const canSaveAs = session.path !== null && !busy;

  return (
    <main className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="toolbar">
          <div className="brand" data-tauri-drag-region>
            <span className="brand-mark" aria-hidden="true">T</span>
            <span>Textora</span>
          </div>
          <button
            type="button"
            className="open-button"
            onClick={handleOpenClick}
            disabled={busy}
            aria-label="Open a text file"
          >
            Open…
          </button>
          <button
            type="button"
            className="save-button"
            onClick={handleSaveClick}
            disabled={!canSave}
            aria-label="Save the current file"
          >
            Save
          </button>
          <button
            type="button"
            className="save-as-button"
            onClick={handleSaveAsClick}
            disabled={!canSaveAs}
            aria-label="Save the current file to a new location"
          >
            Save As…
          </button>
        </div>
        <div className="backend-state" aria-live="polite">
          <span
            className={`status-dot ${backendUnavailable ? "is-error" : ""}`}
          />
          {backendUnavailable
            ? "Document core unavailable"
            : health
              ? `${health.service} v${health.version}`
              : "Connecting document core"}
        </div>
      </header>

      <section className="workspace" aria-label="Document workspace">
        <div className="tab-strip">
          <div className="document-tab" aria-current="page">
            <span>{session.displayName}</span>
            {session.isDirty && <span className="dirty-dot" aria-label="Modified" />}
          </div>
        </div>

        <div className="editor-panel">
          <Editor
            content={session.content}
            disabled={editorLocked}
            onChange={(content) => {
              setSession((current) => updateDocumentContent(current, content));
            }}
          />
          {session.openStatus === "loading" && (
            <div className="notice notice-loading" role="status">Opening…</div>
          )}
          {session.saveStatus === "saving" && (
            <div className="notice notice-loading" role="status">Saving…</div>
          )}
          {session.openStatus === "error" && session.openErrorCode !== null && (
            <div className="notice notice-error" role="alert">
              <span>{describeOpenError(session.openErrorCode)}</span>
              <button type="button" className="notice-dismiss" onClick={handleDismissOpenError}>
                Dismiss
              </button>
            </div>
          )}
          {session.saveStatus === "error" &&
            session.saveError !== null &&
            !conflictPending && (
              <div className="notice notice-error" role="alert">
                <span>{describeSaveError(session.saveError)}</span>
                <button
                  type="button"
                  className="notice-dismiss"
                  onClick={handleDismissSaveError}
                >
                  Dismiss
                </button>
              </div>
            )}
          {conflictPending && (
            <div className="notice notice-conflict" role="alert">
              <span>
                The file changed on disk. Reload the disk version, overwrite it
                with your edits, or cancel.
              </span>
              {conflictOperation.errorMessage !== null && (
                <span className="notice-conflict-error">
                  {conflictOperation.errorMessage}
                </span>
              )}
              <div className="notice-actions">
                <button
                  type="button"
                  className="notice-action"
                  onClick={handleConflictCancel}
                  disabled={conflictOperation.status !== "idle"}
                >
                  {conflictOperation.status === "canceling"
                    ? "Cancelling…"
                    : "Cancel"}
                </button>
                <button
                  type="button"
                  className="notice-action notice-action-primary"
                  onClick={handleConflictReload}
                  disabled={conflictOperation.status !== "idle"}
                >
                  {conflictOperation.status === "reloading"
                    ? "Reloading…"
                    : "Reload"}
                </button>
                <button
                  type="button"
                  className="notice-action notice-action-danger"
                  onClick={handleConflictOverwrite}
                  disabled={conflictOperation.status !== "idle"}
                >
                  {conflictOperation.status === "overwriting"
                    ? "Overwriting…"
                    : "Overwrite"}
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="statusbar">
          <div>{session.isDirty ? "Modified" : "Saved"}</div>
          <div className="statusbar-details">
            <button
              type="button"
              className="format-settings-summary"
              onClick={openFormatSettings}
              aria-label={`Encoding ${encodingChoiceDisplayName(
                saveFormat.encoding,
              )}, line ending ${
                session.lineEnding === "mixed"
                  ? "Mixed"
                  : lineEndingDisplayName(saveFormat.lineEnding)
              }. Open format settings.`}
            >
              <span>{encodingChoiceDisplayName(saveFormat.encoding)}</span>
              <span className="format-settings-sep" aria-hidden="true">·</span>
              <span>
                {session.lineEnding === "mixed"
                  ? "Mixed"
                  : lineEndingDisplayName(saveFormat.lineEnding)}
              </span>
              {session.lineEnding === "mixed" && (
                <span className="format-settings-warning" aria-hidden="true">!</span>
              )}
            </button>
            {session.readOnly && <span className="readonly-badge">Read-only</span>}
          </div>
        </footer>
        {formatSettingsOpen && (
          <div
            className="format-settings-popover"
            role="dialog"
            aria-modal="false"
            aria-label="Format settings"
          >
            <label className="save-as-field">
              <span>Encoding</span>
              <select
                value={formatDraft.encoding}
                onChange={(event) =>
                  setFormatDraft((current) => ({
                    ...current,
                    encoding: event.target.value as EncodingChoice,
                  }))
                }
              >
                <option value="utf8">UTF-8</option>
                <option value="utf8-bom">UTF-8 (BOM)</option>
                <option value="gbk">GBK / CP936</option>
              </select>
            </label>
            <label className="save-as-field">
              <span>Line ending</span>
              <select
                value={formatDraft.lineEnding}
                onChange={(event) =>
                  setFormatDraft((current) => ({
                    ...current,
                    lineEnding: event.target.value as LineEndingChoice,
                  }))
                }
              >
                <option value="lf">LF</option>
                <option value="crlf">CRLF</option>
              </select>
            </label>
            {session.lineEnding === "mixed" && (
              <p className="format-settings-mixed" role="alert">
                Content has mixed line endings. Choose LF or CRLF before saving.
              </p>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="confirm-cancel"
                onClick={cancelFormatSettings}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-save"
                onClick={confirmFormatSettings}
                autoFocus
              >
                Done
              </button>
            </div>
          </div>
        )}
      </section>

      {session.openStatus === "awaiting-discard-confirm" && (
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Discard changes">
          <div className="confirm-dialog">
            <p className="confirm-message">
              This document has unsaved changes. Discard them and open another file?
            </p>
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" onClick={handleConfirmCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="confirm-discard"
                onClick={handleConfirmDiscard}
                autoFocus
              >
                Discard changes
              </button>
            </div>
          </div>
        </div>
      )}

      {saveAsDialog.open && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Choose save format and location"
        >
          <div className="confirm-dialog save-as-dialog">
            <p className="confirm-message">
              Choose the file format first. Next, macOS will ask for the file name and location.
            </p>
            <label className="save-as-field">
              <span>Encoding</span>
              <select
                value={saveAsDialog.encoding}
                onChange={(event) =>
                  setSaveAsDialog((current) => ({
                    ...current,
                    encoding: event.target.value as EncodingChoice,
                  }))
                }
              >
                <option value="utf8">UTF-8</option>
                <option value="utf8-bom">UTF-8 (BOM)</option>
                <option value="gbk">GBK / CP936</option>
              </select>
            </label>
            <label className="save-as-field">
              <span>Line ending</span>
              <select
                value={saveAsDialog.lineEnding}
                onChange={(event) =>
                  setSaveAsDialog((current) => ({
                    ...current,
                    lineEnding: event.target.value as LineEndingChoice,
                  }))
                }
              >
                <option value="lf">LF</option>
                <option value="crlf">CRLF</option>
              </select>
            </label>
            <div className="confirm-actions">
              <button type="button" className="confirm-cancel" onClick={handleSaveAsCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="confirm-discard"
                onClick={handleSaveAsConfirm}
                autoFocus
              >
                Choose Name and Location…
              </button>
            </div>
          </div>
        </div>
      )}

      {fileMissingPending && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="File missing on disk"
        >
          <div className="confirm-dialog">
            <p className="confirm-message">
              The file "{session.displayName}" no longer exists on disk. Keep
              the current content in the editor (you will need to save it to a
              new location), or discard it and start fresh?
            </p>
            {fileMissingOperation.errorMessage !== null && (
              <p className="notice-conflict-error" role="alert">
                {fileMissingOperation.errorMessage}
              </p>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="confirm-cancel"
                onClick={handleFileMissingKeep}
                disabled={fileMissingOperation.status !== "idle"}
                autoFocus
              >
                {fileMissingOperation.status === "keeping"
                  ? "Keeping…"
                  : "Keep content"}
              </button>
              <button
                type="button"
                className="confirm-discard"
                onClick={handleFileMissingDiscard}
                disabled={fileMissingOperation.status !== "idle"}
              >
                {fileMissingOperation.status === "discarding"
                  ? "Discarding…"
                  : "Discard"}
              </button>
            </div>
          </div>
        </div>
      )}

      {closeConfirmPending && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Save before closing?"
        >
          <div className="confirm-dialog">
            <p className="confirm-message">
              Do you want to save the changes to "{session.displayName}" before
              closing?
            </p>
            {closeConfirmError !== null && (
              <p className="notice-conflict-error" role="alert">
                {closeConfirmError}
              </p>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="confirm-cancel"
                onClick={handleCloseCancel}
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-discard"
                onClick={handleCloseDiscard}
              >
                Don't Save
              </button>
              <button
                type="button"
                className="confirm-save"
                onClick={handleCloseSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
