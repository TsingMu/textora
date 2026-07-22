import { useEffect, useState } from "react";
import "./App.css";
import {
  cancelOpen,
  cancelSave,
  commitOpenedDocument,
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
  checkBackendHealth,
  describeOpenError,
  describeSaveError,
  encodingDisplayName,
  isDocumentCommandError,
  lineEndingDisplayName,
  readDocumentContent,
  saveDocument,
  selectAndOpenDocument,
  type DocumentCommandError,
  type HealthStatus,
} from "./platform";

const initialDocument = createNewDocument();

function App() {
  const [session, setSession] = useState<DocumentSession>(initialDocument);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);

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
      setSession((current) => commitSavedDocument(current, descriptor));
    } catch (err) {
      const error: DocumentCommandError = isDocumentCommandError(err)
        ? err
        : { code: "save-failed", message: "save request failed" };
      setSession((current) => failSave(current, error));
    }
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
    const next = requestSave(session);
    if (next === session) {
      return;
    }
    setSession(next);
    if (next.saveStatus === "saving") {
      void runSavePipeline(next.id, next.content);
    }
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

  const busy = isBusy(session);
  const editorLocked =
    session.openStatus === "loading" || session.saveStatus === "saving";
  const canSave =
    session.path !== null &&
    session.isDirty &&
    !session.readOnly &&
    !busy;

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
          {session.saveStatus === "error" && session.saveError !== null && (
            <div className="notice notice-error" role="alert">
              <span>{describeSaveError(session.saveError)}</span>
              <button type="button" className="notice-dismiss" onClick={handleDismissSaveError}>
                Dismiss
              </button>
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
    </main>
  );
}

export default App;
