import { useEffect, useState } from "react";
import "./App.css";
import { createNewDocument, updateDocumentContent } from "./documentSession";
import { Editor } from "./Editor";
import { checkBackendHealth, type HealthStatus } from "./platform";

const initialDocument = createNewDocument();

function App() {
  const [document, setDocument] = useState(initialDocument);
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

  return (
    <main className="app-shell">
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>Textora</span>
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
            <span>{document.displayName}</span>
            {document.isDirty && <span className="dirty-dot" aria-label="Modified" />}
          </div>
        </div>

        <div className="editor-panel">
          <Editor
            content={document.content}
            onChange={(content) => {
              setDocument((current) => updateDocumentContent(current, content));
            }}
          />
        </div>

        <footer className="statusbar">
          <div>{document.isDirty ? "Modified" : "Saved"}</div>
          <div className="statusbar-details">
            <span>{document.lineEnding}</span>
            <span>{document.encoding}</span>
          </div>
        </footer>
      </section>
    </main>
  );
}

export default App;
