import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import "./App.css";
import appIconUrl from "../icon.png";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import {
  cancelOpen,
  cancelSave,
  commitExternalMetadata,
  commitOpenedDocument,
  commitSavedAs,
  commitSavedDocument,
  failOpen,
  failSave,
  isBusy,
  requestSave,
  requestExternalConflict,
  startLoading,
  updateDocumentContent,
  type DocumentSession,
} from "./documentSession";
import { Editor, type EditorHandle } from "./Editor";
import { MarkdownWysiwygEditor } from "./MarkdownWysiwygEditor";
import { detectLanguage, languageDisplayName } from "./languageRecognition";
import {
  activeDocument,
  addOpenedDocumentTab,
  addUntitledTab,
  appendRestoredTab,
  closeTabCleanly,
  createInitialTabSession,
  finalizeRestoredTabs,
  setMarkdownPreviewOpen,
  setMarkdownWysiwygOpen,
  setMermaidPreviewOpen,
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
  prepareExternalConflict,
  prepareExternalReload,
  prepareSaveAs,
  previewSaveTarget,
  readDocumentContent,
  refreshExternalDocument,
  reloadFromConflict,
  requestAppExit,
  restoreNextSessionDocument,
  retryExternalReload,
  saveAsAt,
  saveDocument,
  selectAndOpenDocument,
  updateOpenFilesManifest,
  type DocumentCommandError,
  EXTERNAL_DOCUMENT_CHANGED_EVENT,
  type ExternalDocumentChanged,
  type EncodingChoice,
  type HealthStatus,
  type KnownDocumentPath,
  type LineEndingChoice,
  type SaveDirectoryGrant,
} from "./platform";
import {
  collectMarkdownBlockMap,
  collectMarkdownMermaidBlocks,
  renderMarkdownPreview,
  type MarkdownBlock,
  type MarkdownMermaidBlockPreview,
} from "./markdownPreview";
import {
  previewBlockIndexForSourceLine,
  previewBlockRelativeTops,
  scrollPreviewToBlock,
  topPreviewBlockIndex,
} from "./markdownPreviewSync";
import {
  renderMermaidPreview,
  type MermaidPreviewResult,
} from "./mermaidPreview";

const initialTabs = createInitialTabSession();
// 启动恢复收尾只允许移除这个初始占位标签，且仅在仍未被用户触碰时。
const initialPlaceholderTabId = initialTabs.tabs[0].tabId;
type ConflictOperationStatus = "idle" | "canceling" | "reloading" | "overwriting";
type FileMissingOperationStatus = "idle" | "keeping" | "discarding";
type FileMissingTarget = {
  tabId: string;
  documentId: string;
  path: string;
  displayName: string;
};
type ExternalReloadErrorTarget = {
  tabId: string;
  documentId: string;
  path: string;
  displayName: string;
  error: DocumentCommandError;
  status: "idle" | "retrying";
};
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
  backendDocumentId: string | null;
  content: string;
};
type CloseIntent = {
  kind: CloseKind;
  active: CloseIntentItem;
  pending: CloseIntentItem[];
  completedDocumentIds: string[];
};
type MermaidPreviewState =
  | { source: string; status: "loading"; html: string }
  | ({ source: string } & MermaidPreviewResult);
type MarkdownMermaidPreviewState = {
  source: string;
  blocks: Record<number, MarkdownMermaidBlockPreview>;
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
  const activeTab = tabSession.tabs.find(
    (tab) => tab.tabId === tabSession.activeTabId,
  );
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
  const [fileMissingPending, setFileMissingPending] =
    useState<FileMissingTarget | null>(null);
  const [fileMissingOperation, setFileMissingOperation] = useState<{
    status: FileMissingOperationStatus;
    errorMessage: string | null;
  }>({ status: "idle", errorMessage: null });
  const [externalReloadErrors, setExternalReloadErrors] = useState<
    Record<string, ExternalReloadErrorTarget>
  >({});
  const [closeConfirmPending, setCloseConfirmPending] = useState(false);
  const [closeConfirmError, setCloseConfirmError] = useState<string | null>(null);
  const [formatJsonNotice, setFormatJsonNotice] = useState<string | null>(null);
  const [saveFormat, setSaveFormat] = useState<{
    encoding: EncodingChoice;
    lineEnding: LineEndingChoice;
  }>({
    encoding: encodingToChoice(session.encoding),
    lineEnding: lineEndingToChoice(session.lineEnding),
  });
  const [formatSettingsOpen, setFormatSettingsOpen] = useState(false);
  const [mixedLineEndingConfirmed, setMixedLineEndingConfirmed] = useState(true);
  const [mermaidPreviews, setMermaidPreviews] = useState<
    Record<string, MermaidPreviewState>
  >({});
  const [markdownMermaidPreviews, setMarkdownMermaidPreviews] = useState<
    Record<string, MarkdownMermaidPreviewState>
  >({});
  const [formatDraft, setFormatDraft] = useState<{
    encoding: EncodingChoice;
    lineEnding: LineEndingChoice;
  }>(saveFormat);
  const [sessionRestore, setSessionRestore] = useState<
    "pending" | "done" | "interrupted"
  >("pending");
  // 恢复结果提示与清单写入失败提示独立展示、独立关闭，避免互相覆盖。
  const [sessionRestoreNotice, setSessionRestoreNotice] = useState<
    string | null
  >(null);
  const [manifestNotice, setManifestNotice] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const tabSessionRef = useRef(tabSession);
  const fileMissingPendingRef = useRef<FileMissingTarget | null>(
    fileMissingPending,
  );
  const fileMissingResolvingRef = useRef(false);
  const busyRef = useRef(false);
  const closeConfirmPendingRef = useRef(false);
  const closeIntentRef = useRef<CloseIntent | null>(null);
  const editorRef = useRef<EditorHandle>(null);
  const closeAuthorizationRef = useRef<{
    validDocumentIds: readonly string[];
  } | null>(null);
  const saveAsPanelRevisionRef = useRef(0);
  const externalReloadsRef = useRef(new Set<string>());
  const focusRefreshesRef = useRef(new Set<string>());
  const previewContentRef = useRef<HTMLDivElement>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const previewProgrammaticScrollRef = useRef(false);
  const editorProgrammaticScrollRef = useRef(false);
  const previewScrollRafRef = useRef<number | null>(null);
  const editorScrollRafRef = useRef<number | null>(null);
  const pendingPreviewScrollLineRef = useRef<number | null>(null);
  const markdownBlockMapRef = useRef<readonly MarkdownBlock[]>([]);
  const markdownPreviewVisibleRef = useRef(false);
  const saveFileNameInputRef = useRef<HTMLInputElement>(null);
  const sessionRestoreStartedRef = useRef(false);
  const manifestGenerationRef = useRef(0);
  // 恢复中断后重试沿用同一后端游标；清单声明的活动索引、已采用标签映射与单项失败
  // 摘要都跨运行保留——最终完成后的提示覆盖本次启动期间的全部失败。
  const restoreActiveManifestIndexRef = useRef<number | null>(null);
  const restoreTabIdByManifestIndexRef = useRef<Map<number, string>>(new Map());
  const restoreFailureSummariesRef = useRef<string[]>([]);
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

  function showFileMissing(target: FileMissingTarget) {
    fileMissingPendingRef.current = target;
    setFileMissingOperation({ status: "idle", errorMessage: null });
    setFileMissingPending(target);
  }

  function showFileMissingForTab(
    tabId: string,
    documentId: string,
    expectedPath?: string,
    options: { allowBusy?: boolean; allowSaveError?: boolean } = {},
  ): boolean {
    if (fileMissingPendingRef.current !== null) {
      return false;
    }
    const tab = tabSessionRef.current.tabs.find(
      (item) => item.tabId === tabId && item.document.id === documentId,
    );
    if (
      tab === undefined ||
      tab.document.path === null ||
      (expectedPath !== undefined && tab.document.path !== expectedPath) ||
      (!options.allowBusy && isBusy(tab.document)) ||
      (!options.allowSaveError && tab.document.saveStatus === "error")
    ) {
      return false;
    }
    showFileMissing({
      tabId,
      documentId,
      path: tab.document.path,
      displayName: tab.document.displayName,
    });
    return true;
  }

  function clearExternalReloadError(documentId: string) {
    setExternalReloadErrors((current) => {
      if (!(documentId in current)) return current;
      const next = { ...current };
      delete next[documentId];
      return next;
    });
  }

  function showExternalReloadError(
    tabId: string,
    documentId: string,
    error: DocumentCommandError,
    expectedPath?: string,
  ): boolean {
    const tab = tabSessionRef.current.tabs.find(
      (item) => item.tabId === tabId && item.document.id === documentId,
    );
    if (
      tab === undefined ||
      tab.document.path === null ||
      (expectedPath !== undefined && tab.document.path !== expectedPath) ||
      tab.document.isDirty ||
      isBusy(tab.document)
    ) {
      clearExternalReloadError(documentId);
      return false;
    }
    const path = tab.document.path;
    setExternalReloadErrors((current) => ({
      ...current,
      [documentId]: {
        tabId,
        documentId,
        path,
        displayName: tab.document.displayName,
        error,
        status: "idle",
      },
    }));
    return true;
  }

  async function applyExternalReloadReady(
    tabId: string,
    documentId: string,
    ready: Awaited<ReturnType<typeof prepareExternalReload>>,
  ) {
    if (ready === null) {
      updateTabDocument(tabId, (document) =>
        document.id === documentId ? cancelOpen(document) : document,
      );
      return;
    }
    if (ready.kind === "metadata") {
      updateTabDocument(tabId, (document) =>
        document.id === documentId &&
        document.openStatus === "loading" &&
        !document.isDirty
          ? commitExternalMetadata(document, ready.descriptor)
          : document,
      );
      return;
    }
    const buffer = await readDocumentContent(documentId);
    const content = new TextDecoder().decode(buffer);
    updateTabDocument(tabId, (document) =>
      document.id === documentId &&
      document.openStatus === "loading" &&
      !document.isDirty
        ? commitOpenedDocument(document, ready.descriptor, content)
        : document,
    );
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
        backendDocumentId:
          tab.document.path === null ? null : tab.document.id,
        content: tab.document.content,
      }));
  }

  function handleExternalDocumentChange(payload: ExternalDocumentChanged) {
    const tab = tabSessionRef.current.tabs.find(
      (item) => item.document.id === payload.documentId,
    );
    if (
      tab === undefined ||
      tab.document.path === null ||
      isBusy(tab.document) ||
      externalReloadsRef.current.has(payload.documentId)
    ) {
      return;
    }

    const tabId = tab.tabId;
    if (payload.kind === "missing") {
      if (
        tab.document.saveStatus === "error" ||
        fileMissingPendingRef.current !== null
      ) {
        return;
      }
      const path = tab.document.path;
      externalReloadsRef.current.add(payload.documentId);
      void checkTargetExists(payload.documentId)
        .then((exists) => {
          if (exists) {
            return;
          }
          showFileMissingForTab(tabId, payload.documentId, path);
        })
        .catch(() => {
          // 保留当前内容；下次实时事件或聚焦复核可重试缺失确认。
        })
        .finally(() => {
          externalReloadsRef.current.delete(payload.documentId);
        });
      return;
    }
    if (payload.kind === "reloadFailed") {
      if (payload.error === undefined) {
        return;
      }
      showExternalReloadError(
        tabId,
        payload.documentId,
        payload.error,
        tab.document.path,
      );
      return;
    }
    if (payload.kind === "metadata") {
      const path = tab.document.path;
      externalReloadsRef.current.add(payload.documentId);
      clearExternalReloadError(payload.documentId);
      void prepareExternalReload(payload.documentId)
        .then((ready) => {
          if (ready?.kind !== "metadata") {
            return;
          }
          updateTabDocument(tabId, (document) =>
            document.id === payload.documentId &&
            document.path === path &&
            !isBusy(document)
              ? commitExternalMetadata(document, ready.descriptor)
              : document,
          );
        })
        .finally(() => {
          externalReloadsRef.current.delete(payload.documentId);
        });
      return;
    }
    if (tab.document.isDirty) {
      if (payload.kind !== "content") {
        return;
      }
      const snapshot = tab.document.content;
      externalReloadsRef.current.add(payload.documentId);
      let accepted = false;
      flushSync(() => {
        updateTabSession((current) =>
          updateDocumentByTabId(current, tabId, (document) => {
            if (
              document.id !== payload.documentId ||
              document.content !== snapshot ||
              !document.isDirty ||
              isBusy(document)
            ) {
              return document;
            }
            accepted = true;
            return requestExternalConflict(document);
          }),
        );
      });
      if (!accepted) {
        externalReloadsRef.current.delete(payload.documentId);
        return;
      }

      void prepareExternalConflict(payload.documentId, snapshot)
        .then((established) => {
          updateTabDocument(tabId, (document) => {
            if (
              document.id !== payload.documentId ||
              document.content !== snapshot ||
              document.saveStatus !== "saving"
            ) {
              return document;
            }
            return established
              ? failSave(document, {
                  code: "save-conflict-content-changed",
                  message: "file changed on disk",
                })
              : cancelSave(document);
          });
        })
        .catch(() => {
          updateTabDocument(tabId, (document) =>
            document.id === payload.documentId &&
            document.content === snapshot &&
            document.saveStatus === "saving"
              ? cancelSave(document)
              : document,
          );
        })
        .finally(() => {
          externalReloadsRef.current.delete(payload.documentId);
        });
      return;
    }

    externalReloadsRef.current.add(payload.documentId);
    clearExternalReloadError(payload.documentId);
    let accepted = false;
    flushSync(() => {
      updateTabSession((current) =>
        updateDocumentByTabId(current, tabId, (document) => {
          if (
            document.id !== payload.documentId ||
            document.isDirty ||
            isBusy(document)
          ) {
            return document;
          }
          accepted = true;
          return startLoading(document);
        }),
      );
    });
    if (!accepted) {
      externalReloadsRef.current.delete(payload.documentId);
      return;
    }

    void prepareExternalReload(payload.documentId)
      .then((ready) =>
        applyExternalReloadReady(tabId, payload.documentId, ready),
      )
      .catch(() => {
        updateTabDocument(tabId, (document) =>
          document.id === payload.documentId &&
          document.openStatus === "loading"
            ? cancelOpen(document)
            : document,
        );
      })
      .finally(() => {
        externalReloadsRef.current.delete(payload.documentId);
      });
  }

  function refreshAllExternalDocuments(cancelled: () => boolean) {
    for (const tab of tabSessionRef.current.tabs) {
      const { document } = tab;
      if (
        document.path === null ||
        isBusy(document) ||
        focusRefreshesRef.current.has(document.id)
      ) {
        continue;
      }
      const request = {
        tabId: tab.tabId,
        documentId: document.id,
        path: document.path,
      };
      focusRefreshesRef.current.add(request.documentId);
      void refreshExternalDocument(request.documentId)
        .then((change) => {
          if (cancelled() || change === null) {
            return;
          }
          const latest = tabSessionRef.current.tabs.find(
            (item) => item.tabId === request.tabId,
          );
          if (
            latest?.document.id !== request.documentId ||
            latest.document.path !== request.path
          ) {
            return;
          }
          handleExternalDocumentChange(change);
        })
        .finally(() => {
          focusRefreshesRef.current.delete(request.documentId);
        });
    }
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

  // 启动恢复：新进程只执行一次，逐项推进。Rust 每次至多打开一个清单文件（缓冲有界），
  // 前端取回正文后立即采用为标签，使后续外部变化事件能找到归属标签。只有明确收到
  // `done` 才进入完成态并允许最终清单投影；命令异常中断时保留原清单（未处理文件留在
  // 下次启动恢复列表），显示非模态错误并提供继续同一游标的安全重试。
  async function runSessionRestore() {
    setSessionRestore("pending");
    const failureSummaries = restoreFailureSummariesRef.current;
    let lastAdoptedTabId: string | null = null;
    let nextRestoredTabNumber = tabSessionRef.current.nextTabNumber;
    let completed = false;
    try {
      for (;;) {
        const step = await restoreNextSessionDocument();
        if (step.kind === "done") {
          completed = true;
          break;
        }
        if (step.kind === "started") {
          restoreActiveManifestIndexRef.current = step.activeIndex;
          continue;
        }
        if (step.kind === "already-open") {
          // 中断期间经普通 Open/Save As 打开：清单索引映射到现有标签，不重复建标签。
          const existingTab = tabSessionRef.current.tabs.find(
            (tab) => tab.document.id === step.documentId,
          );
          if (existingTab !== undefined) {
            restoreTabIdByManifestIndexRef.current.set(
              step.manifestIndex,
              existingTab.tabId,
            );
            lastAdoptedTabId = existingTab.tabId;
          }
          continue;
        }
        if (step.kind === "failed") {
          failureSummaries.push(
            `${step.displayName} (${describeOpenError(step.error.code)})`,
          );
          continue;
        }
        try {
          const buffer = await readDocumentContent(step.descriptor.id);
          const content = new TextDecoder().decode(buffer);
          const tabId = `tab-${nextRestoredTabNumber}`;
          nextRestoredTabNumber += 1;
          updateTabSession((current) =>
            appendRestoredTab(current, step.descriptor, content),
          );
          restoreTabIdByManifestIndexRef.current.set(step.manifestIndex, tabId);
          lastAdoptedTabId = tabId;
        } catch {
          failureSummaries.push(
            `${step.descriptor.displayName} (the content could not be read)`,
          );
          try {
            await closeDocument(step.descriptor.id);
          } catch {
            // 清理失败不阻塞启动；残留候选不影响其他文档。
          }
        }
      }
    } catch {
      // 恢复命令异常：中断本次运行，已采用的标签保留，不写任何清单投影。
    }
    const activeManifestIndex = restoreActiveManifestIndexRef.current;
    const activeTabId =
      (activeManifestIndex !== null
        ? restoreTabIdByManifestIndexRef.current.get(activeManifestIndex)
        : undefined) ?? lastAdoptedTabId;
    updateTabSession((current) =>
      finalizeRestoredTabs(current, activeTabId, initialPlaceholderTabId),
    );
    if (completed) {
      setSessionRestore("done");
      if (failureSummaries.length > 0) {
        setSessionRestoreNotice(
          `${failureSummaries.length} file(s) from the last session could not be restored: ${failureSummaries.join("; ")}.`,
        );
      } else {
        setSessionRestoreNotice(null);
      }
    } else {
      setSessionRestore("interrupted");
      setSessionRestoreNotice(
        `The previous session could not be fully restored. Files that were not processed stay on the restore list for the next launch.${
          failureSummaries.length > 0
            ? ` Failed items: ${failureSummaries.join("; ")}.`
            : ""
        }`,
      );
    }
  }

  function handleSessionRestoreRetry() {
    if (sessionRestore !== "interrupted") {
      return;
    }
    void runSessionRestore();
  }

  useEffect(() => {
    if (sessionRestoreStartedRef.current) {
      return;
    }
    sessionRestoreStartedRef.current = true;
    void runSessionRestore();
  }, []);

  // 恢复不再推进（完成或中断）且已有采用标签时，对每个已恢复文件执行一次可信复核：
  // 恢复期间（尤其标签尚未存在时）到达的外部变化事件可能被丢弃，此复核与聚焦兜底共用
  // 同一处理路径补上。
  useEffect(() => {
    if (sessionRestore === "pending") {
      return;
    }
    refreshAllExternalDocuments(() => false);
  }, [sessionRestore]);

  // 恢复完成后，标签集合（顺序/身份/路径）或活动标签变化即提交新的清单投影。generation
  // 进程内单调递增，迟到的异步提交在 Rust 侧被拒绝；写入失败只显示非模态提示。
  const manifestProjectionKey =
    tabSession.tabs
      .map((tab) => `${tab.tabId}:${tab.document.id}:${tab.document.path ?? ""}`)
      .join("|") + `#${tabSession.activeTabId}`;
  useEffect(() => {
    if (sessionRestore !== "done") {
      return;
    }
    const state = tabSessionRef.current;
    const documentIds = state.tabs
      .filter((tab) => tab.document.path !== null)
      .map((tab) => tab.document.id);
    const activeTab = state.tabs.find((tab) => tab.tabId === state.activeTabId);
    const activeDocumentId =
      activeTab !== undefined && activeTab.document.path !== null
        ? activeTab.document.id
        : null;
    const generation = manifestGenerationRef.current + 1;
    manifestGenerationRef.current = generation;
    void updateOpenFilesManifest({ generation, documentIds, activeDocumentId })
      .then((status) => {
        // 只有最新请求明确写入成功时才清除旧失败提示；stale/rejected 均未写入
        // 当前投影，不能据此宣称持久化已经恢复。迟到旧请求不覆盖较新状态。
        if (
          manifestGenerationRef.current === generation &&
          status === "written"
        ) {
          setManifestNotice(null);
        }
      })
      .catch(() => {
        if (manifestGenerationRef.current === generation) {
          setManifestNotice(
            "The list of open files could not be saved for the next launch.",
          );
        }
      });
  }, [sessionRestore, manifestProjectionKey]);

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

  // 把 Format JSON 提示绑定到活动文档身份：切换标签、另存为（路径/身份变化）或文档替换时清除，
  // 避免跨标签或跨文档残留。
  useEffect(() => {
    setFormatJsonNotice(null);
  }, [session.id, session.path]);

  // 窗口关闭拦截 + 聚焦缺失检查（合并到同一 effect 以共享一次 dynamic import）。
  useEffect(() => {
    let cancelled = false;
    let unlistenClose: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;
    let unlistenExternalChange: (() => void) | undefined;

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
              event.preventDefault();
              void hideCurrentWindow();
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

        const stopListeningExternalChange = await listen<ExternalDocumentChanged>(
          EXTERNAL_DOCUMENT_CHANGED_EVENT,
          ({ payload }) => handleExternalDocumentChange(payload),
        );
        if (cancelled) {
          stopListeningExternalChange();
          return;
        }
        unlistenExternalChange = stopListeningExternalChange;

        const stopListeningFocus = await getCurrentWindow().onFocusChanged(
          ({ payload: focused }) => {
            if (focused && !cancelled) {
              refreshAllExternalDocuments(() => cancelled);
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
      unlistenClose?.();
      unlistenExit?.();
      unlistenFocus?.();
      unlistenExternalChange?.();
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
    closeAuthorizationRef.current = null;
    await hideCurrentWindow();
  }

  async function hideCurrentWindow() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().hide();
    } catch {
      // 非 Tauri 环境或窗口隐藏失败时保持应用状态不变；未保存保护仍由前置状态机负责。
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
          showFileMissingForTab(
            activeIntent.tabId,
            activeIntent.documentId,
            current.path,
            { allowBusy: true },
          );
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
    if (activeIntent.backendDocumentId !== null) {
      try {
        await closeDocument(activeIntent.backendDocumentId);
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
    const target = fileMissingPending;
    fileMissingResolvingRef.current = true;
    setFileMissingOperation({ status: "keeping", errorMessage: null });
    try {
      await closeDocument(target.documentId);
    } catch {
      fileMissingResolvingRef.current = false;
      setFileMissingOperation({
        status: "idle",
        errorMessage:
          "The file could not be detached from this session. Please try again.",
      });
      return;
    }
    updateTabDocument(target.tabId, (current) =>
      current.id === target.documentId && current.path === target.path
        ? {
            ...current,
            path: null,
            isDirty: true,
            saveStatus: "idle",
            saveError: null,
          }
        : current,
    );
    fileMissingResolvingRef.current = false;
    fileMissingPendingRef.current = null;
    setFileMissingPending(null);
    setFileMissingOperation({ status: "idle", errorMessage: null });
  }

  async function handleFileMissingDiscard() {
    if (!fileMissingPending || fileMissingResolvingRef.current) {
      return;
    }
    const target = fileMissingPending;
    fileMissingResolvingRef.current = true;
    setFileMissingOperation({ status: "discarding", errorMessage: null });
    try {
      await closeDocument(target.documentId);
    } catch {
      fileMissingResolvingRef.current = false;
      setFileMissingOperation({
        status: "idle",
        errorMessage:
          "The file could not be closed. Your content is still preserved.",
      });
      return;
    }
    updateTabSession((current) => {
      const tab = current.tabs.find((item) => item.tabId === target.tabId);
      if (
        tab === undefined ||
        tab.document.id !== target.documentId ||
        tab.document.path !== target.path
      ) {
        return current;
      }
      return closeTabCleanly(current, target.tabId);
    });
    fileMissingResolvingRef.current = false;
    fileMissingPendingRef.current = null;
    setFileMissingPending(null);
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
  }, [fileMissingPending, fileMissingOperation.status]);

  async function handleExternalReloadRetry() {
    const target = externalReloadErrors[session.id];
    if (target === undefined || target.status !== "idle") {
      return;
    }
    let accepted = false;
    setExternalReloadErrors((current) => ({
      ...current,
      [target.documentId]: { ...target, status: "retrying" },
    }));
    flushSync(() => {
      updateTabSession((current) =>
        updateDocumentByTabId(current, target.tabId, (document) => {
          if (
            document.id !== target.documentId ||
            document.path !== target.path ||
            document.isDirty ||
            isBusy(document)
          ) {
            return document;
          }
          accepted = true;
          return startLoading(document);
        }),
      );
    });
    if (!accepted) {
      clearExternalReloadError(target.documentId);
      return;
    }
    externalReloadsRef.current.add(target.documentId);
    try {
      const result = await retryExternalReload(target.documentId);
      if (result === null || result.kind === "unchanged") {
        updateTabDocument(target.tabId, (document) =>
          document.id === target.documentId ? cancelOpen(document) : document,
        );
        clearExternalReloadError(target.documentId);
        return;
      }
      if (result.kind === "missing") {
        updateTabDocument(target.tabId, (document) =>
          document.id === target.documentId ? cancelOpen(document) : document,
        );
        clearExternalReloadError(target.documentId);
        showFileMissingForTab(target.tabId, target.documentId, target.path);
        return;
      }
      if (result.kind === "failed") {
        updateTabDocument(target.tabId, (document) =>
          document.id === target.documentId ? cancelOpen(document) : document,
        );
        showExternalReloadError(
          target.tabId,
          target.documentId,
          result.error,
          target.path,
        );
        return;
      }
      await applyExternalReloadReady(
        target.tabId,
        target.documentId,
        result.reload,
      );
      clearExternalReloadError(target.documentId);
    } catch {
      updateTabDocument(target.tabId, (document) =>
        document.id === target.documentId ? cancelOpen(document) : document,
      );
      showExternalReloadError(
        target.tabId,
        target.documentId,
        { code: "read-failed", message: "external reload retry failed" },
        target.path,
      );
    } finally {
      externalReloadsRef.current.delete(target.documentId);
    }
  }

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
        showFileMissingForTab(tabId, id, undefined, { allowBusy: true });
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
        showFileMissingForTab(
          tabSession.activeTabId,
          current.id,
          current.path ?? undefined,
          { allowBusy: true },
        );
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
      activeExternalReloadError?.status === "retrying" ||
      fileMissingPending !== null ||
      closeConfirmPending ||
      sessionRestore === "pending" ||
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
            backendDocumentId:
              tab.document.path === null ? null : tab.document.id,
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
        backendDocumentId:
          tab.document.path === null ? null : tab.document.id,
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

  // 源码→预览同步滚动：仅在 Markdown Preview 分栏可见时，按块映射把预览容器对应块滚到顶部。
  // 通过 rAF 合并连续滚动事件；程序滚动预览时打标记，供后续预览→源码方向抑制反向循环。
  function handleEditorScroll(topLine: number | null) {
    // 预览→源码程序滚动触发的源码滚动：忽略并复位，避免循环。
    if (editorProgrammaticScrollRef.current) {
      editorProgrammaticScrollRef.current = false;
      return;
    }
    if (!markdownPreviewVisibleRef.current || topLine === null) {
      return;
    }
    pendingPreviewScrollLineRef.current = topLine;
    if (previewScrollRafRef.current !== null) {
      return;
    }
    previewScrollRafRef.current = requestAnimationFrame(() => {
      previewScrollRafRef.current = null;
      const pane = previewPaneRef.current;
      const content = previewContentRef.current;
      const line = pendingPreviewScrollLineRef.current;
      if (pane === null || content === null || line === null) {
        return;
      }
      const blockIndex = previewBlockIndexForSourceLine(
        markdownBlockMapRef.current,
        line,
      );
      if (blockIndex === null) {
        return;
      }
      scrollPreviewToBlock(pane, content, blockIndex, previewProgrammaticScrollRef);
    });
  }

  // 预览→源码同步滚动：仅在 Markdown Preview 可见时，把视口顶部预览块映射回源码行并程序滚动源码。
  // 通过 rAF 合并连续滚动事件；源码→预览程序滚动触发的预览滚动被 previewProgrammaticScrollRef 跳过。
  function handlePreviewScroll() {
    if (!markdownPreviewVisibleRef.current) {
      return;
    }
    if (previewProgrammaticScrollRef.current) {
      previewProgrammaticScrollRef.current = false;
      return;
    }
    if (editorScrollRafRef.current !== null) {
      return;
    }
    editorScrollRafRef.current = requestAnimationFrame(() => {
      editorScrollRafRef.current = null;
      const pane = previewPaneRef.current;
      const content = previewContentRef.current;
      if (pane === null || content === null) {
        return;
      }
      const blockIndex = topPreviewBlockIndex(
        previewBlockRelativeTops(pane, content),
      );
      const blockMap = markdownBlockMapRef.current;
      if (blockIndex === null || blockIndex >= blockMap.length) {
        return;
      }
      editorProgrammaticScrollRef.current = true;
      editorRef.current?.scrollToSourceLine(blockMap[blockIndex].startLine);
      requestAnimationFrame(() => {
        editorProgrammaticScrollRef.current = false;
      });
    });
  }

  function handleFormatJsonClick() {
    if (!canEdit || session.readOnly) {
      return;
    }
    const result = editorRef.current?.formatJsonFence();
    if (result === undefined || result.kind === "unavailable") {
      return;
    }
    if (result.kind === "no-context") {
      setFormatJsonNotice(
        "Place the cursor inside a closed JSON fenced code block.",
      );
    } else if (result.kind === "invalid-json") {
      setFormatJsonNotice("Invalid JSON. The document was not changed.");
    } else {
      setFormatJsonNotice(null);
    }
  }

  function handleMarkdownPreviewToggle() {
    updateTabSession((current) => {
      const tab = current.tabs.find((item) => item.tabId === current.activeTabId);
      if (tab === undefined) return current;
      return setMarkdownPreviewOpen(
        current,
        tab.tabId,
        !tab.markdownPreviewOpen,
      );
    });
  }

  function handleMarkdownWysiwygToggle() {
    // 进入/退出 WYSIWYG 时光标上下文变化，清除可能残留的 Format JSON 提示。
    setFormatJsonNotice(null);
    updateTabSession((current) => {
      const tab = current.tabs.find((item) => item.tabId === current.activeTabId);
      if (tab === undefined) return current;
      return setMarkdownWysiwygOpen(
        current,
        tab.tabId,
        !tab.markdownWysiwygOpen,
      );
    });
  }

  function handleMermaidPreviewToggle() {
    updateTabSession((current) => {
      const tab = current.tabs.find((item) => item.tabId === current.activeTabId);
      if (tab === undefined) return current;
      return setMermaidPreviewOpen(current, tab.tabId, !tab.mermaidPreviewOpen);
    });
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
  const activeExternalReloadError = (() => {
    const target = externalReloadErrors[session.id];
    if (
      target === undefined ||
      target.path !== session.path ||
      target.tabId !== tabSession.activeTabId
    ) {
      return undefined;
    }
    return target;
  })();

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
    sessionRestore === "pending" ||
    saveAsPanel.open ||
    conflictPending ||
    activeExternalReloadError?.status === "retrying" ||
    fileMissingPending !== null ||
    closeConfirmPending;
  busyRef.current = busy;
  const editorLocked =
    sessionRestore === "pending" ||
    session.openStatus === "loading" ||
    session.saveStatus === "saving" ||
    conflictPending ||
    activeExternalReloadError?.status === "retrying" ||
    fileMissingPending !== null ||
    closeConfirmPending ||
    saveAsPanel.open;
  const saveFileNameInvalid = invalidSaveFileName(saveAsPanel.fileName);
  const mixedSaveBlocked =
    session.lineEnding === "mixed" && !mixedLineEndingConfirmed;
  const canSave =
    !session.readOnly && !busy && (session.path === null || session.isDirty);
  const canSaveAs = session.path !== null && !busy;
  const canEdit = !editorLocked;
  const activeLanguage = detectLanguage(session.path, session.displayName);
  const markdownPreviewOpen = activeTab?.markdownPreviewOpen ?? false;
  const markdownWysiwygOpen = activeTab?.markdownWysiwygOpen ?? false;
  const markdownWysiwygVisible =
    activeLanguage === "markdown" && markdownWysiwygOpen;
  const markdownPreviewVisible =
    activeLanguage === "markdown" && markdownPreviewOpen && !markdownWysiwygOpen;
  const markdownMermaidPreview =
    activeTab !== undefined
      ? markdownMermaidPreviews[activeTab.tabId]
      : undefined;
  const markdownPreview = markdownPreviewVisible
    ? renderMarkdownPreview(session.content, {
        mermaidBlocks:
          markdownMermaidPreview?.source === session.content
            ? markdownMermaidPreview.blocks
            : undefined,
      })
    : null;
  // 源码块映射随活动标签源码派生；仅用于源码→预览同步滚动。
  const markdownBlockMap = useMemo(
    () => (markdownPreviewVisible ? collectMarkdownBlockMap(session.content) : []),
    [markdownPreviewVisible, session.content],
  );
  markdownBlockMapRef.current = markdownBlockMap;
  markdownPreviewVisibleRef.current = markdownPreviewVisible;

  // Preview 出现时挂载预览滚动监听，关闭/切走时卸载；同一 aside 元素在内容更新时保持。
  useEffect(() => {
    const pane = previewPaneRef.current;
    if (pane === null || !markdownPreviewVisible) {
      return;
    }
    pane.addEventListener("scroll", handlePreviewScroll, { passive: true });
    return () => pane.removeEventListener("scroll", handlePreviewScroll);
  }, [markdownPreviewVisible, markdownPreview]);
  const mermaidPreviewOpen = activeTab?.mermaidPreviewOpen ?? false;
  const mermaidPreviewVisible =
    activeLanguage === "mermaid" && mermaidPreviewOpen;
  const mermaidPreview =
    activeTab !== undefined ? mermaidPreviews[activeTab.tabId] : undefined;

  useEffect(() => {
    if (!mermaidPreviewVisible || activeTab === undefined) {
      return;
    }

    const tabId = activeTab.tabId;
    const source = session.content;
    setMermaidPreviews((current) => {
      const previous = current[tabId];
      if (previous?.source === source && previous.status !== "loading") {
        return current;
      }
      return {
        ...current,
        [tabId]: {
          source,
          status: "loading",
          html: '<div class="mermaid-preview-loading" role="status">Rendering Mermaid preview…</div>',
        },
      };
    });

    const timeout = window.setTimeout(() => {
      void renderMermaidPreview(source).then((result) => {
        setMermaidPreviews((current) => {
          const existing = current[tabId];
          const tabStillExists = tabSessionRef.current.tabs.some(
            (tab) => tab.tabId === tabId && tab.document.content === source,
          );
          if (!tabStillExists || existing?.source !== source) {
            return current;
          }
          return {
            ...current,
            [tabId]: { source, ...result },
          };
        });
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    activeTab?.tabId,
    mermaidPreviewVisible,
    session.content,
    setMermaidPreviews,
  ]);

  useEffect(() => {
    if (!markdownPreviewVisible || activeTab === undefined) {
      return;
    }

    const tabId = activeTab.tabId;
    const source = session.content;
    const mermaidBlocks = collectMarkdownMermaidBlocks(source);
    if (mermaidBlocks.length === 0) {
      return;
    }

    setMarkdownMermaidPreviews((current) => {
      const previous = current[tabId];
      if (
        previous?.source === source &&
        Object.keys(previous.blocks).length === mermaidBlocks.length &&
        Object.values(previous.blocks).every((block) => block.status !== "loading")
      ) {
        return current;
      }

      const blocks: Record<number, MarkdownMermaidBlockPreview> = {};
      mermaidBlocks.forEach((_block, index) => {
        const previousBlock =
          previous?.source === source ? previous.blocks[index] : undefined;
        blocks[index] =
          previousBlock?.status === "ok" || previousBlock?.status === "error"
            ? previousBlock
            : {
                status: "loading",
                html: '<div class="mermaid-preview-loading" role="status">Rendering Mermaid preview…</div>',
              };
      });

      return {
        ...current,
        [tabId]: { source, blocks },
      };
    });

    const timeout = window.setTimeout(() => {
      void Promise.all(mermaidBlocks.map((block) => renderMermaidPreview(block))).then(
        (results) => {
          setMarkdownMermaidPreviews((current) => {
            const existing = current[tabId];
            const tabStillExists = tabSessionRef.current.tabs.some(
              (tab) => tab.tabId === tabId && tab.document.content === source,
            );
            if (!tabStillExists || existing?.source !== source) {
              return current;
            }

            const blocks: Record<number, MarkdownMermaidBlockPreview> = {};
            results.forEach((result, index) => {
              blocks[index] = {
                status: result.status,
                html: result.html,
              };
            });

            return {
              ...current,
              [tabId]: { source, blocks },
            };
          });
        },
      );
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [
    activeTab?.tabId,
    markdownPreviewVisible,
    session.content,
    setMarkdownMermaidPreviews,
  ]);

  return (
    <main className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="toolbar">
          <div className="brand" data-tauri-drag-region>
            <span className="brand-mark" aria-hidden="true">
              <img src={appIconUrl} alt="" className="brand-mark-image" />
            </span>
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
          {activeLanguage === "markdown" && (
            <>
              <button
                type="button"
                className={`preview-toggle markdown-preview-toggle ${
                  markdownPreviewOpen && !markdownWysiwygOpen ? "is-active" : ""
                }`}
                onClick={handleMarkdownPreviewToggle}
                disabled={busy}
                aria-pressed={markdownPreviewOpen && !markdownWysiwygOpen}
                aria-label={
                  markdownPreviewOpen && !markdownWysiwygOpen
                    ? "Hide Markdown preview"
                    : "Show Markdown preview"
                }
              >
                Preview
              </button>
              <button
                type="button"
                className={`preview-toggle markdown-wysiwyg-toggle ${
                  markdownWysiwygOpen ? "is-active" : ""
                }`}
                onClick={handleMarkdownWysiwygToggle}
                disabled={busy}
                aria-pressed={markdownWysiwygOpen}
                aria-label={
                  markdownWysiwygOpen
                    ? "Hide Markdown WYSIWYG editor"
                    : "Show Markdown WYSIWYG editor"
                }
              >
                WYSIWYG
              </button>
              {!markdownWysiwygOpen && (
                <button
                  type="button"
                  className="format-json-button"
                  onClick={handleFormatJsonClick}
                  disabled={!canEdit || session.readOnly}
                  aria-label="Format the JSON inside the cursor's fenced code block"
                >
                  Format JSON
                </button>
              )}
            </>
          )}
          {activeLanguage === "mermaid" && (
            <button
              type="button"
              className={`preview-toggle mermaid-preview-toggle ${
                mermaidPreviewOpen ? "is-active" : ""
              }`}
              onClick={handleMermaidPreviewToggle}
              disabled={busy}
              aria-pressed={mermaidPreviewOpen}
              aria-label={
                mermaidPreviewOpen
                  ? "Hide Mermaid preview"
                  : "Show Mermaid preview"
              }
            >
              Preview
            </button>
          )}
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

        <div
          className={`editor-panel ${
            markdownPreviewVisible ? "has-markdown-preview" : ""
          } ${markdownWysiwygVisible ? "has-markdown-wysiwyg" : ""
          } ${mermaidPreviewVisible ? "has-mermaid-preview" : ""
          }`}
        >
          {markdownWysiwygVisible ? (
            <MarkdownWysiwygEditor
              content={session.content}
              disabled={editorLocked || session.readOnly}
              onChange={(content) => {
                setSession((current) => updateDocumentContent(current, content));
              }}
            />
          ) : (
            <div className="editor-source-pane">
              <Editor
                ref={editorRef}
                content={session.content}
                disabled={editorLocked}
                language={activeLanguage}
                onChange={(content) => {
                  setSession((current) => updateDocumentContent(current, content));
                }}
                onScroll={handleEditorScroll}
              />
            </div>
          )}
          {markdownPreviewVisible && markdownPreview !== null && (
            <aside
              ref={previewPaneRef}
              className={`markdown-preview-pane ${
                markdownPreview.status === "error" ? "is-error" : ""
              }`}
              aria-label="Markdown preview"
            >
              <div
                ref={previewContentRef}
                className="markdown-preview-content"
                dangerouslySetInnerHTML={{ __html: markdownPreview.html }}
              />
            </aside>
          )}
          {mermaidPreviewVisible && mermaidPreview !== undefined && (
            <aside
              className={`mermaid-preview-pane ${
                mermaidPreview.status === "error" ? "is-error" : ""
              }`}
              aria-label="Mermaid preview"
            >
              <div
                className="mermaid-preview-content"
                dangerouslySetInnerHTML={{ __html: mermaidPreview.html }}
              />
            </aside>
          )}
          {formatJsonNotice !== null && (
            <div className="notice notice-format-json" role="status">
              <span>{formatJsonNotice}</span>
              <button
                type="button"
                className="notice-dismiss"
                onClick={() => setFormatJsonNotice(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          {sessionRestore === "pending" && (
            <div className="notice notice-loading" role="status">
              Restoring previous session…
            </div>
          )}
          {sessionRestoreNotice !== null && (
            <div className="notice notice-error notice-session" role="status">
              <span>{sessionRestoreNotice}</span>
              {sessionRestore === "interrupted" && (
                <button
                  type="button"
                  className="notice-action"
                  onClick={handleSessionRestoreRetry}
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                className="notice-dismiss"
                onClick={() => setSessionRestoreNotice(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          {manifestNotice !== null && (
            <div className="notice notice-error notice-session" role="status">
              <span>{manifestNotice}</span>
              <button
                type="button"
                className="notice-dismiss"
                onClick={() => setManifestNotice(null)}
              >
                Dismiss
              </button>
            </div>
          )}
          {session.openStatus === "loading" && (
            <div className="notice notice-loading" role="status">Opening…</div>
          )}          {session.saveStatus === "saving" && (
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
          {activeExternalReloadError !== undefined &&
            !session.isDirty &&
            session.openStatus !== "loading" && (
              <div className="notice notice-error notice-external-reload" role="alert">
                <span>
                  The disk version could not be reloaded.{" "}
                  {describeOpenError(activeExternalReloadError.error.code)}
                </span>
                <button
                  type="button"
                  className="notice-action"
                  onClick={handleExternalReloadRetry}
                  disabled={activeExternalReloadError.status !== "idle"}
                >
                  {activeExternalReloadError.status === "retrying"
                    ? "Retrying…"
                    : "Retry"}
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
            <span className="statusbar-language">{languageDisplayName(activeLanguage)}</span>
            <span className="format-settings-sep" aria-hidden="true">·</span>
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
              The file "{fileMissingPending.displayName}" no longer exists on
              disk. Keep the current content in the editor (you will need to
              save it to a new location), or discard it and start fresh?
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
