import { useEffect, useState } from "react";
import "./App.css";
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
  describeConflictReloadError,
  describeOpenError,
  describeSaveError,
  encodingDisplayName,
  encodingToChoice,
  isDocumentCommandError,
  lineEndingDisplayName,
  lineEndingToChoice,
  readDocumentContent,
  reloadFromConflict,
  saveAs,
  saveDocument,
  selectAndOpenDocument,
  type DocumentCommandError,
  type EncodingChoice,
  type HealthStatus,
  type LineEndingChoice,
} from "./platform";

const initialDocument = createNewDocument();
type ConflictOperationStatus = "idle" | "canceling" | "reloading";

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
      setSession((current) => failSave(current, error));
    }
  }

  async function runSaveAsPipeline(
    id: string | null,
    encoding: EncodingChoice,
    lineEnding: LineEndingChoice,
    content: string,
  ) {
    try {
      const descriptor = await saveAs({ id, encoding, lineEnding, content });
      if (descriptor === null) {
        // 用户在系统保存对话框取消；内容、关联与未保存状态保持不变。
        setSession((current) => cancelSave(current));
        return;
      }
      setSession((current) => commitSavedAs(current, descriptor));
    } catch (err) {
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
    setSaveAsDialog((current) => ({ ...current, open: false }));
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

  const busy = isBusy(session) || saveAsDialog.open || conflictPending;
  const editorLocked =
    session.openStatus === "loading" ||
    session.saveStatus === "saving" ||
    conflictPending;
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
                The file changed on disk. Reload the disk version or cancel to
                keep your edits.
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
              </div>
            </div>
          )}
        </div>

        <footer className="statusbar">
          <div>{session.isDirty ? "Modified" : "Saved"}</div>
          <div className="statusbar-details">
            <span>{lineEndingDisplayName(session.lineEnding)}</span>
            <span>{encodingDisplayName(session.encoding)}</span>
            {session.readOnly && <span className="readonly-badge">Read-only</span>}
          </div>
        </footer>
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
        <div className="confirm-overlay" role="dialog" aria-modal="true" aria-label="Choose save format">
          <div className="confirm-dialog save-as-dialog">
            <p className="confirm-message">Choose the encoding and line ending for the file.</p>
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
