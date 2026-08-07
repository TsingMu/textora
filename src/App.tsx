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
  requestSave,
  startLoading,
  updateDocumentContent,
  type DocumentSession,
} from "./documentSession";
import { Editor, type EditorHandle } from "./Editor";
import {
  activeDocument,
  addOpenedDocumentTab,
  addUntitledTab,
  closeTabCleanly,
  createInitialTabSession,
  switchActiveTab,
  updateActiveDocument,
  updateDocumentByTabId,
  type TabSessionState,
} from "./tabSession";
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
  pickSaveDirectory,
  prepareSaveAs,
  previewSaveTarget,
  readDocumentContent,
  reloadFromConflict,
  requestAppExit,
  saveAsAt,
  saveDocument,
  selectAndOpenDocument,
  type DocumentCommandError,
  type EncodingChoice,
  type HealthStatus,
  type KnownDocumentPath,
  type LineEndingChoice,
  type SaveDirectoryGrant,
} from "./platform";

const initialTabs = createInitialTabSession();
type ConflictOperationStatus = "idle" | "canceling" | "reloading" | "overwriting";
type FileMissingOperationStatus = "idle" | "keeping" | "discarding";
type SaveAsPanelStatus =
  | "preparing"
  | "idle"
  | "choosing-directory"
  | "previewing"
  | "saving";
type SaveAsPanelState = {
  open: boolean;
  status: SaveAsPanelStatus;
  fileName: string;
  directory: SaveDirectoryGrant | null;
  replacePending: boolean;
  errorMessage: string | null;
};
type CloseKind = "window" | "app-exit" | "tab";
type CloseIntentItem = {
  tabId: string;
  documentId: string;
  content: string;
};
type CloseIntent = {
  kind: CloseKind;
  active: CloseIntentItem;
  pending: CloseIntentItem[];
  completedDocumentIds: string[];
};

function invalidSaveFileName(fileName: string): boolean {
  return (
    fileName.length === 0 ||
    fileName === "." ||
    fileName === ".." ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName.includes("\0")
  );
}

function App() {
  const [tabSession, setTabSession] = useState<TabSessionState>(initialTabs);
  const session = activeDocument(tabSession);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [conflictOperation, setConflictOperation] = useState<{
    status: ConflictOperationStatus;
    errorMessage: string | null;
  }>({ status: "idle", errorMessage: null });
  const [saveAsPanel, setSaveAsPanel] = useState<SaveAsPanelState>({
    open: false,
    status: "idle",
    fileName: "",
    directory: null,
    replacePending: false,
    errorMessage: null,
  });
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
    encoding: encodingToChoice(session.encoding),
    lineEnding: lineEndingToChoice(session.lineEnding),
  });
  const [formatSettingsOpen, setFormatSettingsOpen] = useState(false);
  const [mixedLineEndingConfirmed, setMixedLineEndingConfirmed] = useState(true);
  const [formatDraft, setFormatDraft] = useState<{
    encoding: EncodingChoice;
    lineEnding: LineEndingChoice;
  }>(saveFormat);
  const sessionRef = useRef(session);
  const tabSessionRef = useRef(tabSession);
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
  const editorRef = useRef<EditorHandle>(null);
  const closeAuthorizationRef = useRef<{
    validDocumentIds: readonly string[];
  } | null>(null);
  const saveAsPanelRevisionRef = useRef(0);
  const saveFileNameInputRef = useRef<HTMLInputElement>(null);
  sessionRef.current = session;
  tabSessionRef.current = tabSession;
  fileMissingPendingRef.current = fileMissingPending;

  function setSession(
    update:
      | DocumentSession
      | ((document: DocumentSession) => DocumentSession),
  ) {
    setTabSession((current) =>
      updateActiveDocument(
        current,
        typeof update === "function" ? update : () => update,
      ),
    );
  }

  function updateTabDocument(
    tabId: string,
    update: (document: DocumentSession) => DocumentSession,
  ) {
    setTabSession((current) => updateDocumentByTabId(current, tabId, update));
  }

  function updateTabSession(
    update: (state: TabSessionState) => TabSessionState,
  ) {
    setTabSession((current) => {
      const next = update(current);
      tabSessionRef.current = next;
      return next;
    });
  }

  function knownDocumentPathsForTabs(
    state: TabSessionState,
  ): KnownDocumentPath[] {
    return state.tabs.flatMap((tab) =>
      tab.document.path === null
        ? []
        : [{ tabId: tab.tabId, path: tab.document.path }],
    );
  }

  function dirtyCloseItems(state: TabSessionState): CloseIntentItem[] {
    return state.tabs
      .filter((tab) => tab.document.isDirty)
      .map((tab) => ({
        tabId: tab.tabId,
        documentId: tab.document.id,
        content: tab.document.content,
      }));
  }

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
    setMixedLineEndingConfirmed(session.lineEnding !== "mixed");
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
            const authorization = closeAuthorizationRef.current;
            if (authorization !== null) {
              closeAuthorizationRef.current = null;
              const active = activeDocument(tabSessionRef.current);
              if (authorization.validDocumentIds.includes(active.id)) {
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
            const pending = dirtyCloseItems(tabSessionRef.current);
            if (pending.length === 0) {
              return;
            }
            event.preventDefault();
            startCloseIntent("window", pending);
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
            const pending = dirtyCloseItems(tabSessionRef.current);
            if (pending.length === 0) {
              // 未修改：完成正常退出。
              void requestAppExit();
              return;
            }
            startCloseIntent("app-exit", pending);
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

  function startCloseIntent(kind: CloseKind, items: CloseIntentItem[]) {
    const [active, ...pending] = items;
    if (active === undefined) return;
    closeIntentRef.current = {
      kind,
      active,
      pending,
      completedDocumentIds: [],
    };
    updateTabSession((current) => switchActiveTab(current, active.tabId));
    closeConfirmPendingRef.current = true;
    setCloseConfirmError(null);
    setCloseConfirmPending(true);
  }

  async function finishCloseIntent(
    intent: CloseIntent,
    completedDocumentIds: readonly string[],
  ) {
    const allCompleted = [
      ...intent.completedDocumentIds,
      ...completedDocumentIds,
    ];
    const [next, ...remaining] = intent.pending;
    if (next !== undefined) {
      closeIntentRef.current = {
        ...intent,
        active: next,
        pending: remaining,
        completedDocumentIds: allCompleted,
      };
      updateTabSession((current) => switchActiveTab(current, next.tabId));
      closeConfirmPendingRef.current = true;
      setCloseConfirmError(null);
      setCloseConfirmPending(true);
      return;
    }

    const active = activeDocument(tabSessionRef.current);
    await executeAuthorizedClose(intent.kind, [...allCompleted, active.id], intent.active.tabId);
  }

  async function executeAuthorizedClose(
    kind: CloseKind,
    validDocumentIds: readonly string[],
    tabId?: string,
  ) {
    closeIntentRef.current = null;
    if (kind === "tab") {
      for (const id of new Set(validDocumentIds)) {
        if (!id.startsWith("untitled-")) {
          await closeDocument(id);
        }
      }
      if (tabId !== undefined) {
        setTabSession((current) => closeTabCleanly(current, tabId));
      }
      return;
    }
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
    const activeIntent = intent?.active;
    if (
      intent === null ||
      activeIntent === undefined ||
      activeIntent.documentId !== sessionRef.current.id ||
      activeIntent.tabId !== tabSessionRef.current.activeTabId
    ) {
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
        const descriptor = await saveDocument(activeIntent.documentId, activeIntent.content);
        setSession((s) => commitSavedDocument(s, descriptor));
        await finishCloseIntent(intent, [activeIntent.documentId]);
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
      void openSaveAsPanel();
    }
  }

  async function handleCloseDiscard() {
    const intent = closeIntentRef.current;
    const activeIntent = intent?.active;
    if (
      intent === null ||
      activeIntent === undefined ||
      activeIntent.documentId !== sessionRef.current.id ||
      activeIntent.tabId !== tabSessionRef.current.activeTabId
    ) {
      clearCloseIntent();
      setCloseConfirmPending(false);
      closeConfirmPendingRef.current = false;
      return;
    }
    setCloseConfirmPending(false);
    closeConfirmPendingRef.current = false;
    if (!activeIntent.documentId.startsWith("untitled-")) {
      try {
        await closeDocument(activeIntent.documentId);
      } catch {
        setCloseConfirmError(
          "The document could not be closed safely. Please try again.",
        );
        closeConfirmPendingRef.current = true;
        setCloseConfirmPending(true);
        return;
      }
    }
    if (intent.kind === "tab") {
      updateTabSession((current) => closeTabCleanly(current, activeIntent.tabId));
      clearCloseIntent();
      return;
    }
    updateTabSession((current) => closeTabCleanly(current, activeIntent.tabId));
    await finishCloseIntent(intent, [activeIntent.documentId]);
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

  async function runOpenPipeline(tabId: string) {
    const knownDocuments = knownDocumentPathsForTabs(tabSessionRef.current);

    try {
      const selection = await selectAndOpenDocument(knownDocuments);
      if (selection === null) {
        updateTabDocument(tabId, (current) => cancelOpen(current));
        return;
      }
      if (selection.kind === "existing") {
        setTabSession((current) =>
          switchActiveTab(
            updateDocumentByTabId(current, tabId, (document) =>
              cancelOpen(document),
            ),
            selection.tabId,
          ),
        );
        return;
      }
      const descriptor = selection.descriptor;
      const buffer = await readDocumentContent(descriptor.id);
      const content = new TextDecoder().decode(buffer);
      setTabSession((current) =>
        addOpenedDocumentTab(
          updateDocumentByTabId(current, tabId, (document) =>
            cancelOpen(document),
          ),
          descriptor,
          content,
        ),
      );
    } catch (err) {
      const code = isDocumentCommandError(err) ? err.code : "read-failed";
      updateTabDocument(tabId, (current) => failOpen(current, code));
    }
  }

  async function runSavePipeline(tabId: string, id: string, content: string) {
    try {
      const descriptor = await saveDocument(id, content);
      setConflictOperation({ status: "idle", errorMessage: null });
      updateTabDocument(tabId, (current) => {
        if (current.id !== id) return current;
        return commitSavedDocument(current, descriptor);
      });
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
      updateTabDocument(tabId, (current) => {
        if (current.id !== id) return current;
        return failSave(current, error);
      });
    }
  }

  async function openSaveAsPanel() {
    const current = sessionRef.current;
    const documentId = current.path === null ? null : current.id;
    const revision = saveAsPanelRevisionRef.current + 1;
    saveAsPanelRevisionRef.current = revision;
    setSaveAsPanel({
      open: true,
      status: "preparing",
      fileName: current.displayName,
      directory: null,
      replacePending: false,
      errorMessage: null,
    });
    try {
      const draft = await prepareSaveAs(documentId);
      if (saveAsPanelRevisionRef.current !== revision) return;
      setSaveAsPanel({
        open: true,
        status: "idle",
        fileName: draft.fileName,
        directory: draft.directory,
        replacePending: false,
        errorMessage: null,
      });
    } catch (err) {
      if (saveAsPanelRevisionRef.current !== revision) return;
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "prepare save-as failed" };
      setSaveAsPanel((panel) => ({
        ...panel,
        status: "idle",
        errorMessage: describeSaveError(error),
      }));
    }
  }

  function cancelSaveAsPanel() {
    if (saveAsPanel.status === "saving") return;
    saveAsPanelRevisionRef.current += 1;
    clearCloseIntent();
    setSaveAsPanel((panel) => ({ ...panel, open: false }));
  }

  async function handleChooseSaveDirectory() {
    if (saveAsPanel.status !== "idle") return;
    const current = sessionRef.current;
    const documentId = current.path === null ? null : current.id;
    const revision = saveAsPanelRevisionRef.current;
    setSaveAsPanel((panel) => ({
      ...panel,
      status: "choosing-directory",
      replacePending: false,
      errorMessage: null,
    }));
    try {
      const directory = await pickSaveDirectory(documentId);
      if (saveAsPanelRevisionRef.current !== revision) return;
      if (directory === null) {
        cancelSaveAsPanel();
        return;
      }
      setSaveAsPanel((panel) => ({
        ...panel,
        status: "idle",
        directory,
      }));
    } catch (err) {
      if (saveAsPanelRevisionRef.current !== revision) return;
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "directory selection failed" };
      setSaveAsPanel((panel) => ({
        ...panel,
        status: "idle",
        errorMessage: describeSaveError(error),
      }));
    }
  }

  async function performSaveAs(panel: SaveAsPanelState) {
    const current = sessionRef.current;
    const documentId = current.path === null ? null : current.id;
    const closeIntent = closeIntentRef.current;
    setSaveAsPanel((value) => ({
      ...value,
      status: "saving",
      errorMessage: null,
    }));
    setSession((value) => ({
      ...value,
      saveStatus: "saving",
      saveError: null,
    }));
    try {
      const descriptor = await saveAsAt({
        id: documentId,
        directoryId: panel.directory!.id,
        fileName: panel.fileName,
        encoding: saveFormat.encoding,
        lineEnding: saveFormat.lineEnding,
        content: current.content,
      });
      setSaveAsPanel((value) => ({ ...value, open: false, status: "idle" }));
      setSession((value) => commitSavedAs(value, descriptor));
      if (closeIntent !== null) {
        await finishCloseIntent(closeIntent, [
          closeIntent.active.documentId,
          descriptor.id,
        ]);
      }
    } catch (err) {
      clearCloseIntent();
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "save request failed" };
      if (error.code === "save-conflict-content-changed") {
        setSaveAsPanel((value) => ({ ...value, open: false, status: "idle" }));
        setConflictOperation({ status: "idle", errorMessage: null });
        setSession((value) => failSave(value, error));
        return;
      }
      if (error.code === "save-conflict-target-missing") {
        setSaveAsPanel((value) => ({ ...value, open: false, status: "idle" }));
        targetCheckRevisionRef.current += 1;
        targetCheckInFlightRef.current = null;
        fileMissingPendingRef.current = true;
        setFileMissingOperation({ status: "idle", errorMessage: null });
        setFileMissingPending(true);
        return;
      }
      setSession((value) => cancelSave(value));
      setSaveAsPanel((value) => ({
        ...value,
        status: "idle",
        replacePending: false,
        directory:
          error.code === "missing-grant" || error.code === "grant-mismatch"
            ? null
            : value.directory,
        errorMessage: describeSaveError(error),
      }));
    }
  }

  async function handleSaveAsConfirm() {
    if (
      saveAsPanel.status !== "idle" ||
      saveAsPanel.directory === null ||
      invalidSaveFileName(saveAsPanel.fileName) ||
      (session.lineEnding === "mixed" && !mixedLineEndingConfirmed)
    ) {
      return;
    }
    if (saveAsPanel.replacePending) {
      await performSaveAs(saveAsPanel);
      return;
    }

    setSaveAsPanel((panel) => ({
      ...panel,
      status: "previewing",
      errorMessage: null,
    }));
    const documentId = session.path === null ? null : session.id;
    try {
      const preview = await previewSaveTarget({
        id: documentId,
        directoryId: saveAsPanel.directory.id,
        fileName: saveAsPanel.fileName,
        currentTabId: tabSessionRef.current.activeTabId,
        knownDocuments: knownDocumentPathsForTabs(tabSessionRef.current),
      });
      if (preview.occupiedTabId != null) {
        setSaveAsPanel((panel) => ({
          ...panel,
          status: "idle",
          replacePending: false,
          errorMessage:
            "That save target is already open in another tab. Switch to that tab or choose a different name.",
        }));
        return;
      }
      if (preview.exists && !preview.isCurrentPath) {
        setSaveAsPanel((panel) => ({
          ...panel,
          status: "idle",
          replacePending: true,
        }));
        return;
      }
      await performSaveAs(saveAsPanel);
    } catch (err) {
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "target preview failed" };
      setSaveAsPanel((panel) => ({
        ...panel,
        status: "idle",
        directory:
          error.code === "missing-grant" || error.code === "grant-mismatch"
            ? null
            : panel.directory,
        errorMessage: describeSaveError(error),
      }));
    }
  }

  function handleOpenClick() {
    if (isBusy(session)) {
      return;
    }
    const tabId = tabSession.activeTabId;
    updateTabDocument(tabId, (current) => startLoading(current));
    void runOpenPipeline(tabId);
  }

  function tabsAreLocked(): boolean {
    return (
      saveAsPanel.open ||
      conflictPending ||
      fileMissingPending ||
      closeConfirmPending ||
      session.openStatus === "loading" ||
      session.openStatus === "awaiting-discard-confirm"
    );
  }

  function handleNewTabClick() {
    if (tabsAreLocked()) return;
    setTabSession((current) => addUntitledTab(current));
  }

  function handleSwitchTab(tabId: string) {
    if (tabsAreLocked()) return;
    setTabSession((current) => switchActiveTab(current, tabId));
  }

  async function handleCloseTab(tabId: string) {
    if (tabsAreLocked()) return;
    const tab = tabSessionRef.current.tabs.find((item) => item.tabId === tabId);
    if (tab === undefined) return;
    setTabSession((current) => switchActiveTab(current, tabId));
    if (!tab.document.isDirty) {
      try {
        if (tab.document.path !== null) {
          await closeDocument(tab.document.id);
        }
      } catch {
        setCloseConfirmError(
          "The document could not be closed safely. Please try again.",
        );
        closeIntentRef.current = {
          kind: "tab",
          active: {
            tabId,
            documentId: tab.document.id,
            content: tab.document.content,
          },
          pending: [],
          completedDocumentIds: [],
        };
        closeConfirmPendingRef.current = true;
        setCloseConfirmPending(true);
        return;
      }
      setTabSession((current) => closeTabCleanly(current, tabId));
      return;
    }
    closeIntentRef.current = {
      kind: "tab",
      active: {
        tabId,
        documentId: tab.document.id,
        content: tab.document.content,
      },
      pending: [],
      completedDocumentIds: [],
    };
    closeConfirmPendingRef.current = true;
    setCloseConfirmError(null);
    setCloseConfirmPending(true);
  }

  function handleSaveClick() {
    // 新建文档（无路径）经格式选择进入首次保存流程；已打开文档走普通原路径保存。
    if (session.path === null) {
      if (isBusy(session)) {
        return;
      }
      void openSaveAsPanel();
      return;
    }
    const next = requestSave(session);
    if (next === session) {
      return;
    }
    setSession(next);
    if (next.saveStatus === "saving") {
      void runSavePipeline(tabSession.activeTabId, next.id, next.content);
    }
  }

  function handleSaveAsClick() {
    if (isBusy(session)) {
      return;
    }
    void openSaveAsPanel();
  }

  function handleColumnSequenceClick() {
    editorRef.current?.fillColumnBlockSequence();
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
    if (session.lineEnding === "mixed") {
      setMixedLineEndingConfirmed(true);
    }
    setFormatSettingsOpen(false);
  }

  function handleConfirmDiscard() {
    const tabId = tabSessionRef.current.activeTabId;
    updateTabDocument(tabId, (current) => startLoading(current));
    void runOpenPipeline(tabId);
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

  useEffect(() => {
    if (!saveAsPanel.open || saveAsPanel.status === "saving") return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelSaveAsPanel();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [saveAsPanel.open, saveAsPanel.status]);

  useEffect(() => {
    if (saveAsPanel.open && saveAsPanel.status === "idle") {
      saveFileNameInputRef.current?.focus();
      saveFileNameInputRef.current?.select();
    }
  }, [saveAsPanel.open, saveAsPanel.status]);

  const busy =
    isBusy(session) ||
    saveAsPanel.open ||
    conflictPending ||
    fileMissingPending ||
    closeConfirmPending;
  busyRef.current = busy;
  const editorLocked =
    session.openStatus === "loading" ||
    session.saveStatus === "saving" ||
    conflictPending ||
    fileMissingPending ||
    closeConfirmPending ||
    saveAsPanel.open;
  const saveFileNameInvalid = invalidSaveFileName(saveAsPanel.fileName);
  const mixedSaveBlocked =
    session.lineEnding === "mixed" && !mixedLineEndingConfirmed;
  const canSave =
    !session.readOnly && !busy && (session.path === null || session.isDirty);
  const canSaveAs = session.path !== null && !busy;
  const canEdit = !editorLocked;

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
          <button
            type="button"
            className="column-sequence-button"
            onClick={handleColumnSequenceClick}
            disabled={!canEdit}
            aria-label="Fill selected column block with a decimal sequence"
            title="Fill column sequence (⌥⌘N)"
          >
            Sequence
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
          {tabSession.tabs.map((tab) => (
            <div
              key={tab.tabId}
              className={`document-tab ${
                tab.tabId === tabSession.activeTabId ? "is-active" : ""
              }`}
            >
              <button
                type="button"
                className="document-tab-select"
                aria-current={
                  tab.tabId === tabSession.activeTabId ? "page" : undefined
                }
                onClick={() => handleSwitchTab(tab.tabId)}
                disabled={tabsAreLocked() && tab.tabId !== tabSession.activeTabId}
              >
                <span className="document-tab-title">{tab.document.displayName}</span>
                {tab.document.isDirty && (
                  <span className="dirty-dot" aria-label="Modified" />
                )}
              </button>
              <button
                type="button"
                className="document-tab-close"
                aria-label={`Close ${tab.document.displayName}`}
                onClick={() => {
                  void handleCloseTab(tab.tabId);
                }}
                disabled={tabsAreLocked() && tab.tabId !== tabSession.activeTabId}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="new-tab-button"
            onClick={handleNewTabClick}
            disabled={tabsAreLocked()}
            aria-label="New tab"
          >
            +
          </button>
        </div>

        <div className="editor-panel">
          <Editor
            ref={editorRef}
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

      {saveAsPanel.open && (
        <div
          className="confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Save file as"
        >
          <div className="confirm-dialog save-as-dialog">
            <p className="confirm-message">
              Choose the file name and save location. The current format comes
              from the setting in the bottom-right corner.
            </p>
            <label className="save-as-field">
              <span>File name</span>
              <input
                ref={saveFileNameInputRef}
                type="text"
                value={saveAsPanel.fileName}
                onChange={(event) =>
                  setSaveAsPanel((current) => ({
                    ...current,
                    fileName: event.target.value,
                    replacePending: false,
                    errorMessage: null,
                  }))
                }
                disabled={saveAsPanel.status !== "idle"}
                aria-invalid={saveFileNameInvalid}
              />
            </label>
            {saveFileNameInvalid && saveAsPanel.status === "idle" && (
              <p className="save-as-validation" role="alert">
                Enter a file name without path separators.
              </p>
            )}
            <div className="save-as-field save-as-location-field">
              <span>Location</span>
              <span className="save-as-location">
                {saveAsPanel.directory?.displayName ?? "No location selected"}
              </span>
              <button
                type="button"
                className="save-as-location-button"
                onClick={handleChooseSaveDirectory}
                disabled={saveAsPanel.status !== "idle"}
              >
                {saveAsPanel.status === "choosing-directory"
                  ? "Choosing…"
                  : "Choose location…"}
              </button>
            </div>
            <div className="save-as-format-summary">
              <span>Format</span>
              <strong>
                {encodingChoiceDisplayName(saveFormat.encoding)} · {" "}
                {lineEndingDisplayName(saveFormat.lineEnding)}
              </strong>
            </div>
            {mixedSaveBlocked && (
              <p className="save-as-validation" role="alert">
                Content has mixed line endings. Cancel this panel, then choose
                LF or CRLF in the bottom-right format setting before saving.
              </p>
            )}
            {saveAsPanel.replacePending && (
              <p className="save-as-replace-warning" role="alert">
                A file with this name already exists in the selected location.
                Replace it?
              </p>
            )}
            {saveAsPanel.errorMessage !== null && (
              <p className="save-as-validation" role="alert">
                {saveAsPanel.errorMessage}
              </p>
            )}
            {saveAsPanel.status === "preparing" && (
              <p className="save-as-progress" role="status">
                Preparing save target…
              </p>
            )}
            <div className="confirm-actions">
              <button
                type="button"
                className="confirm-cancel"
                onClick={cancelSaveAsPanel}
                disabled={saveAsPanel.status === "saving"}
              >
                Cancel
              </button>
              <button
                type="button"
                className={
                  saveAsPanel.replacePending
                    ? "confirm-replace"
                    : "confirm-save"
                }
                onClick={handleSaveAsConfirm}
                disabled={
                  saveAsPanel.status !== "idle" ||
                  saveAsPanel.directory === null ||
                  saveFileNameInvalid ||
                  mixedSaveBlocked
                }
              >
                {saveAsPanel.status === "saving"
                  ? "Saving…"
                  : saveAsPanel.status === "previewing"
                    ? "Checking…"
                    : saveAsPanel.replacePending
                      ? "Replace"
                      : "Save"}
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
