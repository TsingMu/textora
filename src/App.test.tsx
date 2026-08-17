// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom does not implement Range geometry. CodeMirror schedules text measurement
// with requestAnimationFrame, so the missing method can otherwise surface after an
// assertion or unmount as a nondeterministic unhandled error.
if (!("getClientRects" in Range.prototype)) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const invokeMock = vi.fn();
const tauriWindowMock = vi.hoisted(() => ({
  focusHandler: undefined as
    | ((event: { payload: boolean }) => void)
    | undefined,
  closeHandler: undefined as
    | ((event: { preventDefault: () => void }) => void | Promise<void>)
    | undefined,
  close: vi.fn(),
  hide: vi.fn(),
  allowedCloseCount: 0,
  deferCloseEvent: false,
  pendingProgrammaticClose: undefined as
    | (() => Promise<void>)
    | undefined,
  unlisten: vi.fn(),
}));

const tauriEventMock = vi.hoisted(() => ({
  exitRequestedHandler: undefined as (() => void) | undefined,
  externalChangeHandler: undefined as
    | ((
        payload: {
          documentId: string;
          kind: "content" | "metadata" | "missing" | "reloadFailed";
          error?: { code: "file-too-large" | "unsupported-encoding" | "changed-during-read" | "read-failed"; message: string };
        },
      ) => void)
    | undefined,
  unlisten: vi.fn(),
}));
const mermaidPreviewMock = vi.hoisted(() => ({
  renderMermaidPreview: vi.fn(async (source: string) => {
    if (source.includes("BROKEN")) {
      return {
        status: "error" as const,
        message: "mock Mermaid syntax error",
        html: '<div class="mermaid-preview-error">mock Mermaid syntax error</div>',
      };
    }
    return {
      status: "ok" as const,
      html: `<svg data-testid="mock-mermaid"><text>${source}</text></svg>`,
    };
  }),
}));

const sessionCommandsMock = vi.hoisted(() => ({
  restoreSteps: [] as unknown[],
  manifestStatus: "written" as unknown,
  manifestCalls: [] as unknown[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => {
    const cmd = args[0] as string;
    if (cmd === "restore_next_session_document") {
      const step = sessionCommandsMock.restoreSteps.shift() ?? { kind: "done" };
      return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
    }
    if (cmd === "update_open_files_manifest") {
      sessionCommandsMock.manifestCalls.push(args[1]);
      const status = sessionCommandsMock.manifestStatus;
      return status instanceof Error ? Promise.reject(status) : Promise.resolve(status);
    }
    return invokeMock(...args);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async (
      handler: (event: { payload: boolean }) => void,
    ) => {
      tauriWindowMock.focusHandler = handler;
      return tauriWindowMock.unlisten;
    },
    onCloseRequested: async (
      handler: (event: { preventDefault: () => void }) => void | Promise<void>,
    ) => {
      tauriWindowMock.closeHandler = handler;
      return tauriWindowMock.unlisten;
    },
    close: async () => {
      tauriWindowMock.close();
      const dispatchClose = async () => {
        const preventDefault = vi.fn();
        await tauriWindowMock.closeHandler?.({ preventDefault });
        if (preventDefault.mock.calls.length === 0) {
          tauriWindowMock.allowedCloseCount += 1;
        }
      };
      if (tauriWindowMock.deferCloseEvent) {
        tauriWindowMock.pendingProgrammaticClose = dispatchClose;
      } else {
        await dispatchClose();
      }
    },
    hide: async () => {
      tauriWindowMock.hide();
    },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    if (event === "textora-app-exit-requested") {
      tauriEventMock.exitRequestedHandler = () => handler({ payload: null });
    } else if (event === "textora-external-document-changed") {
      tauriEventMock.externalChangeHandler = (payload) => handler({ payload });
    }
    return tauriEventMock.unlisten;
  },
}));
vi.mock("./mermaidPreview", () => mermaidPreviewMock);
import App from "./App";

function setupInvoke() {
  mermaidPreviewMock.renderMermaidPreview.mockClear();
  sessionCommandsMock.restoreSteps = [{ kind: "done" }];
  sessionCommandsMock.manifestStatus = "written";
  sessionCommandsMock.manifestCalls = [];
  invokeMock.mockImplementation(async (cmd: string, _args?: unknown) => {
    if (cmd === "health_check") {
      return { service: "document-core", version: "0.1.0" };
    }
    if (cmd === "select_and_open_document") {
      return {
        id: "doc-9",
        path: "/tmp/notes.txt",
        displayName: "notes.txt",
        byteCount: 5,
        encoding: "gbk",
        lineEnding: "lf",
        fingerprint: { sizeBytes: 5, sha256: "deadbeef" },
        readOnly: false,
      };
    }
    if (cmd === "read_document_content") {
      const buffer = new TextEncoder().encode("Hello").buffer;
      return buffer;
    }
    if (cmd === "request_app_exit") {
      return undefined;
    }
    if (cmd === "prepare_save_as") {
      return { fileName: "Untitled", directory: null };
    }
    throw new Error(`unexpected invoke ${cmd}`);
  });
}

async function emitWindowFocus(focused = true) {
  await vi.waitFor(() => {
    expect(tauriWindowMock.focusHandler).toBeTypeOf("function");
  });
  await act(async () => {
    tauriWindowMock.focusHandler?.({ payload: focused });
    await Promise.resolve();
  });
}

async function emitWindowClose() {
  await vi.waitFor(() => {
    expect(tauriWindowMock.closeHandler).toBeTypeOf("function");
  });
  const preventDefault = vi.fn();
  await act(async () => {
    await tauriWindowMock.closeHandler?.({ preventDefault });
  });
  return preventDefault;
}

async function emitAppExitRequest() {
  await vi.waitFor(() => {
    expect(tauriEventMock.exitRequestedHandler).toBeTypeOf("function");
  });
  await act(async () => {
    tauriEventMock.exitRequestedHandler?.();
    await Promise.resolve();
  });
}

async function emitExternalChange(
  payload: {
    documentId: string;
    kind: "content" | "metadata" | "missing" | "reloadFailed";
    error?: { code: "file-too-large" | "unsupported-encoding" | "changed-during-read" | "read-failed"; message: string };
  },
) {
  await vi.waitFor(() => {
    expect(tauriEventMock.externalChangeHandler).toBeTypeOf("function");
  });
  await act(async () => {
    tauriEventMock.externalChangeHandler?.(payload);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function resetTauriWindowMock() {
  tauriWindowMock.focusHandler = undefined;
  tauriWindowMock.closeHandler = undefined;
  tauriWindowMock.close.mockReset();
  tauriWindowMock.hide.mockReset();
  tauriWindowMock.allowedCloseCount = 0;
  tauriWindowMock.deferCloseEvent = false;
  tauriWindowMock.pendingProgrammaticClose = undefined;
  tauriWindowMock.unlisten.mockReset();
  tauriEventMock.exitRequestedHandler = undefined;
  tauriEventMock.externalChangeHandler = undefined;
  tauriEventMock.unlisten.mockReset();
}

describe("App open flow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens a file and atomically replaces editor content and tab", async () => {
    await act(async () => {
      root.render(<App />);
    });

    const openButton = container.querySelector<HTMLButtonElement>(".open-button");
    expect(openButton).not.toBeNull();

    await act(async () => {
      openButton?.click();
    });

    const callNames = invokeMock.mock.calls.map((c) => c[0]);
    expect(callNames).toContain("select_and_open_document");
    expect(callNames).toContain("read_document_content");
    expect(
      invokeMock.mock.calls.find((call) => call[0] === "select_and_open_document"),
    ).toEqual(["select_and_open_document", { knownDocuments: [] }]);

    const tabText = container.querySelector(".document-tab.is-active")?.textContent ?? "";
    expect(tabText).toContain("notes.txt");

    const editorText = container.querySelector(".cm-content")?.textContent ?? "";
    expect(editorText).toContain("Hello");

    expect(container.querySelector(".statusbar")?.textContent).toContain("GBK");
    expect(container.querySelector(".statusbar")?.textContent).toContain("LF");
  });

  it("reloads a clean open tab when Rust reports an external content change", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "prepare_external_reload") {
        expect(args).toEqual({ id: "doc-9" });
        return {
          kind: "content",
          descriptor: {
            id: "doc-9",
            path: "/tmp/notes.txt",
            displayName: "notes.txt",
            byteCount: 16,
            encoding: { utf8: { bom: false } },
            lineEnding: "crlf",
            fingerprint: { sizeBytes: 16, sha256: "new" },
            readOnly: false,
          },
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Changed outside\r\n").buffer;
      }
      return baseInvoke(cmd, args, options);
    });

    await emitExternalChange({ documentId: "doc-9", kind: "content" });
    await vi.waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toContain(
        "Changed outside",
      );
    });
    expect(container.querySelector(".statusbar")?.textContent).toContain("CRLF");
  });

  it("updates readonly metadata without reloading editor content", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "prepare_external_reload") {
        expect(args).toEqual({ id: "doc-9" });
        return {
          kind: "metadata",
          descriptor: {
            id: "doc-9",
            path: "/tmp/notes.txt",
            displayName: "notes.txt",
            byteCount: 5,
            encoding: "gbk",
            lineEnding: "lf",
            fingerprint: { sizeBytes: 5, sha256: "abc" },
            readOnly: true,
          },
        };
      }
      if (cmd === "read_document_content") {
        throw new Error("metadata must not read content");
      }
      return baseInvoke(cmd, args, options);
    });

    await emitExternalChange({ documentId: "doc-9", kind: "metadata" });

    await vi.waitFor(() => {
      expect(container.querySelector(".readonly-badge")?.textContent).toContain(
        "Read-only",
      );
    });
    expect(container.querySelector(".cm-content")?.textContent).toContain("Hello");
    expect(container.querySelector(".notice-loading")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".save-button")?.disabled).toBe(
      true,
    );
  });

  it("syncs readonly metadata on a dirty tab while preserving local edits", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    await act(async () => {
      editable.textContent = "Local dirty";
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "Local dirty",
        }),
      );
    });

    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "prepare_external_reload") {
        return {
          kind: "metadata",
          descriptor: {
            id: "doc-9",
            path: "/tmp/notes.txt",
            displayName: "notes.txt",
            byteCount: 5,
            encoding: "gbk",
            lineEnding: "lf",
            fingerprint: { sizeBytes: 5, sha256: "abc" },
            readOnly: true,
          },
        };
      }
      return baseInvoke(cmd, args, options);
    });

    await emitExternalChange({ documentId: "doc-9", kind: "metadata" });

    await vi.waitFor(() => {
      expect(container.querySelector(".readonly-badge")?.textContent).toContain(
        "Read-only",
      );
    });
    expect(container.querySelector(".cm-content")?.textContent).toContain("Local dirty");
    expect(container.querySelector(".statusbar")?.textContent).toContain("Modified");
    expect(container.querySelector(".notice-conflict")).toBeNull();
  });

  it("does not adopt an external change while the tab has local edits", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    await act(async () => {
      editable.textContent = "Local edit";
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "Local edit",
        }),
      );
    });
    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "prepare_external_conflict") return true;
      if (cmd === "cancel_conflict") return undefined;
      return baseInvoke(cmd, args, options);
    });
    invokeMock.mockClear();

    await emitExternalChange({ documentId: "doc-9", kind: "content" });

    expect(
      invokeMock.mock.calls.some((call) => call[0] === "prepare_external_reload"),
    ).toBe(false);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "prepare_external_conflict"),
    ).toBe(true);
    expect(container.querySelector(".cm-content")?.textContent).toContain("Local edit");
    expect(container.querySelector(".notice-conflict")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".notice-action")?.click();
    });
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "cancel_conflict"),
    ).toBe(true);
    expect(container.querySelector(".notice-conflict")).toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("Local edit");
  });

  it("unlocks the dirty tab when the external candidate is already stale", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    await act(async () => {
      editable.textContent = "Keep this edit";
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "Keep this edit",
        }),
      );
    });
    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "prepare_external_conflict") return false;
      return baseInvoke(cmd, args, options);
    });

    await emitExternalChange({ documentId: "doc-9", kind: "content" });

    expect(container.querySelector(".notice-conflict")).toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("Keep this edit");
    expect(
      container.querySelector<HTMLElement>(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("true");
  });

  it("routes an external missing event into the missing-file keep flow", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "check_target_exists") return false;
      if (cmd === "close_document") return undefined;
      return baseInvoke(cmd, args, options);
    });

    await emitExternalChange({ documentId: "doc-9", kind: "missing" });
    await vi.waitFor(() => {
      expect(
        container.querySelector('[aria-label="File missing on disk"]'),
      ).not.toBeNull();
    });
    expect(container.querySelector(".confirm-message")?.textContent).toContain(
      "notes.txt",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-cancel")?.click();
      await Promise.resolve();
    });

    expect(
      invokeMock.mock.calls.find((call) => call[0] === "close_document"),
    ).toEqual(["close_document", { id: "doc-9" }]);
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
  });

  it("binds an external missing prompt to a background tab", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const id = `doc-${openCount}`;
        return {
          id,
          path: `/tmp/${id}.txt`,
          displayName: `${id}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: id },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(args?.id ?? "").buffer;
      }
      if (cmd === "check_target_exists") {
        expect(args).toEqual({ id: "doc-1" });
        return false;
      }
      if (cmd === "close_document") return undefined;
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );

    await emitExternalChange({ documentId: "doc-1", kind: "missing" });
    await vi.waitFor(() => {
      expect(container.querySelector(".confirm-message")?.textContent).toContain(
        "doc-1.txt",
      );
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-discard")?.click();
      await Promise.resolve();
    });

    expect(
      invokeMock.mock.calls.find((call) => call[0] === "close_document"),
    ).toEqual(["close_document", { id: "doc-1" }]);
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );
    const tabLabels = Array.from(
      container.querySelectorAll(".document-tab"),
      (tab) => tab.textContent ?? "",
    );
    expect(tabLabels.join(" ")).not.toContain("doc-1.txt");
  });

  it("ignores a stale external missing event after the target exists again", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "check_target_exists") return true;
      return baseInvoke(cmd, args, options);
    });

    await emitExternalChange({ documentId: "doc-9", kind: "missing" });

    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "close_document"),
    ).toBe(false);
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "notes.txt",
    );
  });

  it("shows a retryable external reload failure and adopts the retry result", async () => {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    const baseInvoke = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown, options?: unknown) => {
      if (cmd === "retry_external_reload") {
        expect(args).toEqual({ id: "doc-9" });
        return {
          kind: "ready",
          reload: {
            kind: "content",
            descriptor: {
              id: "doc-9",
              path: "/tmp/notes.txt",
              displayName: "notes.txt",
              byteCount: 14,
              encoding: { utf8: { bom: false } },
              lineEnding: "lf",
              fingerprint: { sizeBytes: 14, sha256: "retry" },
              readOnly: false,
            },
          },
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Retry content\n").buffer;
      }
      return baseInvoke(cmd, args, options);
    });

    await emitExternalChange({
      documentId: "doc-9",
      kind: "reloadFailed",
      error: { code: "unsupported-encoding", message: "invalid" },
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".notice-external-reload")?.textContent).toContain(
        "not valid UTF-8",
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".notice-external-reload .notice-action")?.click();
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toContain(
        "Retry content",
      );
    });
    expect(container.querySelector(".notice-external-reload")).toBeNull();
  });

  it("keeps an external reload failure bound to its background tab", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const id = `doc-${openCount}`;
        return {
          id,
          path: `/tmp/${id}.txt`,
          displayName: `${id}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: id },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(args?.id ?? "").buffer;
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );

    await emitExternalChange({
      documentId: "doc-1",
      kind: "reloadFailed",
      error: { code: "changed-during-read", message: "changed" },
    });
    expect(container.querySelector(".notice-external-reload")).toBeNull();

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-1.txt",
    );
    expect(container.querySelector(".notice-external-reload")?.textContent).toContain(
      "changed while being read",
    );
  });

  it("keeps the current document when the dialog is cancelled", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return null;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => {
      root.render(<App />);
    });

    const openButton = container.querySelector<HTMLButtonElement>(".open-button");
    await act(async () => {
      openButton?.click();
    });

    // No document/content IPC should fire when the user cancels the dialog.
    const callNames = invokeMock.mock.calls.map((c) => c[0]);
    expect(callNames).not.toContain("read_document_content");

    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain("Untitled");
  });

  it("switches to an existing tab when opening an already-open path", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        if (openCount === 1) {
          return {
            id: "doc-1",
            path: "/tmp/notes.txt",
            displayName: "notes.txt",
            byteCount: 5,
            encoding: "gbk",
            lineEnding: "lf",
            fingerprint: { sizeBytes: 5, sha256: "deadbeef" },
            readOnly: false,
          };
        }
        expect(args).toEqual({
          knownDocuments: [{ tabId: "tab-2", path: "/tmp/notes.txt" }],
        });
        return { kind: "existing", tabId: "tab-2" };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    expect(container.querySelectorAll(".document-tab")).toHaveLength(2);
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "notes.txt",
    );
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "read_document_content"),
    ).toHaveLength(1);
  });

  it("shows a user-facing error notice when the file is too large", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        throw { code: "file-too-large", message: "too big" };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => {
      root.render(<App />);
    });

    const openButton = container.querySelector<HTMLButtonElement>(".open-button");
    await act(async () => {
      openButton?.click();
    });

    const notice = container.querySelector(".notice-error");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("50 MB");
    // Current document is untouched.
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain("Untitled");
  });

  it.each([
    ["unsupported-encoding", "not valid UTF-8"],
    ["changed-during-read", "changed while being read"],
    ["read-failed", "could not be read"],
  ] as const)("shows the %s error without replacing the document", async (code, message) => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        throw { code, message: "safe backend message" };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => {
      root.render(<App />);
    });
    const openButton = container.querySelector<HTMLButtonElement>(".open-button");
    await act(async () => {
      openButton?.click();
    });

    expect(container.querySelector(".notice-error")?.textContent).toContain(message);
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain("Untitled");
  });

  it("reports a dialog failure instead of treating it as cancellation", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        throw new Error("dialog unavailable");
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => {
      root.render(<App />);
    });
    const openButton = container.querySelector<HTMLButtonElement>(".open-button");
    await act(async () => {
      openButton?.click();
    });

    expect(container.querySelector(".notice-error")?.textContent).toContain(
      "could not be read",
    );
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain("Untitled");
  });

  it("makes the editor read-only while the open dialog and read are pending", async () => {
    let resolveSelection: ((descriptor: null) => void) | undefined;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "health_check") {
        return Promise.resolve({ service: "document-core", version: "0.1.0" });
      }
      if (cmd === "select_and_open_document") {
        return new Promise<null>((resolve) => {
          resolveSelection = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`));
    });

    await act(async () => {
      root.render(<App />);
    });
    const openButton = container.querySelector<HTMLButtonElement>(".open-button");
    await act(async () => {
      openButton?.click();
    });

    expect(
      container.querySelector<HTMLElement>(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(openButton?.disabled).toBe(true);
    openButton?.click();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "select_and_open_document"),
    ).toHaveLength(1);

    await act(async () => {
      resolveSelection?.(null);
    });
    expect(
      container.querySelector<HTMLElement>(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("true");
  });
});

describe("App tab session", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function tabTitles() {
    return Array.from(container.querySelectorAll(".document-tab-title")).map(
      (node) => node.textContent,
    );
  }

  function editContent(content: string) {
    const editable = container.querySelector<HTMLElement>(".cm-content");
    if (editable === null) throw new Error("missing editor");
    editable.textContent = content;
    editable.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: content,
      }),
    );
  }

  it("creates numbered Untitled tabs and keeps edits isolated when switching", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    expect(tabTitles()).toEqual(["Untitled", "Untitled 2"]);

    await act(async () => editContent("second tab"));
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(container.querySelector(".cm-content")?.textContent ?? "").toBe("");

    await act(async () => editContent("first tab"));
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "second tab",
    );
  });

  it("refreshes the matching background tab without changing the active tab", async () => {
    let openCount = 0;
    let externalRead = false;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const id = `doc-${openCount}`;
        return {
          id,
          path: `/tmp/${id}.txt`,
          displayName: `${id}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: id },
          readOnly: false,
        };
      }
      if (cmd === "prepare_external_reload") {
        externalRead = true;
        return {
          kind: "content",
          descriptor: {
            id: "doc-1",
            path: "/tmp/doc-1.txt",
            displayName: "doc-1.txt",
            byteCount: 8,
            encoding: { utf8: { bom: false } },
            lineEnding: "lf",
            fingerprint: { sizeBytes: 8, sha256: "changed" },
            readOnly: false,
          },
        };
      }
      if (cmd === "read_document_content") {
        const text = externalRead && args?.id === "doc-1" ? "updated 1" : args?.id;
        return new TextEncoder().encode(text).buffer;
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );

    await emitExternalChange({ documentId: "doc-1", kind: "content" });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toContain("updated 1");
    });
  });

  it("updates readonly metadata on a background tab without changing the active tab", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const id = `doc-${openCount}`;
        return {
          id,
          path: `/tmp/${id}.txt`,
          displayName: `${id}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: id },
          readOnly: false,
        };
      }
      if (cmd === "prepare_external_reload") {
        expect(args).toEqual({ id: "doc-1" });
        return {
          kind: "metadata",
          descriptor: {
            id: "doc-1",
            path: "/tmp/doc-1.txt",
            displayName: "doc-1.txt",
            byteCount: 5,
            encoding: { utf8: { bom: false } },
            lineEnding: "lf",
            fingerprint: { sizeBytes: 5, sha256: "doc-1" },
            readOnly: true,
          },
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(args?.id ?? "").buffer;
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await emitExternalChange({ documentId: "doc-1", kind: "metadata" });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );
    expect(container.querySelector(".readonly-badge")).toBeNull();

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-1.txt",
    );
    expect(container.querySelector(".readonly-badge")?.textContent).toContain(
      "Read-only",
    );
  });

  it("refreshes every associated tab on focus and updates a changed background tab", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const id = `doc-${openCount}`;
        return {
          id,
          path: `/tmp/${id}.txt`,
          displayName: `${id}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: id },
          readOnly: false,
        };
      }
      if (cmd === "refresh_external_document") {
        if (args?.id === "doc-1") {
          return { documentId: "doc-1", kind: "content" };
        }
        return null;
      }
      if (cmd === "prepare_external_reload") {
        return {
          kind: "content",
          descriptor: {
            id: "doc-1",
            path: "/tmp/doc-1.txt",
            displayName: "doc-1.txt",
            byteCount: 13,
            encoding: { utf8: { bom: false } },
            lineEnding: "lf",
            fingerprint: { sizeBytes: 13, sha256: "changed" },
            readOnly: false,
          },
        };
      }
      if (cmd === "read_document_content") {
        const text = args?.id === "doc-1" ? "focus update\n" : args?.id;
        return new TextEncoder().encode(text).buffer;
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await emitWindowFocus();
    await vi.waitFor(() => {
      expect(
        invokeMock.mock.calls.filter((call) => call[0] === "refresh_external_document"),
      ).toHaveLength(2);
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".cm-content")?.textContent).toContain(
        "focus update",
      );
    });
  });

  it("routes a focused refresh for a dirty background tab into conflict", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const id = `doc-${openCount}`;
        return {
          id,
          path: `/tmp/${id}.txt`,
          displayName: `${id}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: id },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(args?.id ?? "").buffer;
      }
      if (cmd === "refresh_external_document") {
        return args?.id === "doc-1"
          ? { documentId: "doc-1", kind: "content" }
          : null;
      }
      if (cmd === "prepare_external_conflict") return true;
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    await act(async () => editContent("dirty from focus"));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await emitWindowFocus();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );
    expect(container.querySelector(".notice-conflict")).toBeNull();

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    expect(container.querySelector(".cm-content")?.textContent).toContain(
      "dirty from focus",
    );
    expect(container.querySelector(".notice-conflict")).not.toBeNull();
  });

  it("binds an external conflict to a dirty background tab", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const id = `doc-${openCount}`;
        return {
          id,
          path: `/tmp/${id}.txt`,
          displayName: `${id}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: id },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(args?.id ?? "").buffer;
      }
      if (cmd === "prepare_external_conflict") return true;
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    await act(async () => editContent("dirty doc one"));
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[2]?.click();
    });

    await emitExternalChange({ documentId: "doc-1", kind: "content" });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "doc-2.txt",
    );
    expect(container.querySelector(".notice-conflict")).toBeNull();

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    expect(container.querySelector(".cm-content")?.textContent).toContain("dirty doc one");
    expect(container.querySelector(".notice-conflict")).not.toBeNull();
  });

  it("closes clean tabs and creates a fresh Untitled after the last tab closes", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-close")[1]?.click();
    });
    expect(tabTitles()).toEqual(["Untitled"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".document-tab-close")?.click();
    });
    expect(tabTitles()).toEqual(["Untitled 3"]);
    expect(container.querySelector(".cm-content")?.textContent ?? "").toBe("");
  });

  it("asks before closing a dirty tab and discards only that tab", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    await act(async () => editContent("dirty second"));
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-close")[1]?.click();
    });
    expect(container.querySelector(".confirm-dialog")?.textContent).toContain(
      "Untitled 2",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-cancel")?.click();
    });
    expect(tabTitles()).toEqual(["Untitled", "Untitled 2"]);

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-close")[1]?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-discard")?.click();
    });
    expect(tabTitles()).toEqual(["Untitled"]);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "close_document"),
    ).toBe(false);
  });

  it("locks tab switching while the Save As modal is open", async () => {
    await act(async () => {
      root.render(<App />);
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    expect(tabTitles()).toEqual(["Untitled", "Untitled 2"]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });
    expect(container.querySelector('[aria-label="Save file as"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>(".new-tab-button")?.disabled).toBe(
      true,
    );

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(
      container
        .querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  it("tracks the detected language per tab without leaking across switches", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-ts",
          path: "/tmp/app.tsx",
          displayName: "app.tsx",
          byteCount: 0,
          encoding: "utf8",
          lineEnding: "lf",
          fingerprint: { sizeBytes: 0, sha256: "zero" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    expect(tabTitles()).toEqual(["Untitled", "app.tsx"]);
    expect(container.querySelector(".statusbar-language")?.textContent).toBe("TypeScript");

    // 切到初始 Untitled 标签：状态栏退化为普通文本，且不影响 app.tsx 的识别。
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(container.querySelector(".statusbar-language")?.textContent).toBe("Plain Text");

    // 切回 .tsx 标签：语言跟随活动标签恢复，证明高亮按标签隔离。
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });
    expect(container.querySelector(".statusbar-language")?.textContent).toBe("TypeScript");
  });

  it("shows a closed Mermaid preview toggle for Mermaid documents", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-mermaid",
          path: "/tmp/diagram.mmd",
          displayName: "diagram.mmd",
          byteCount: 20,
          encoding: "utf8",
          lineEnding: "lf",
          fingerprint: { sizeBytes: 20, sha256: "mermaid" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("flowchart TD\nA-->B").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    expect(tabTitles()).toEqual(["Untitled", "diagram.mmd"]);
    expect(container.querySelector(".statusbar-language")?.textContent).toBe("Mermaid");
    expect(container.querySelector(".markdown-preview-toggle")).toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>(".mermaid-preview-toggle")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(container.querySelector(".markdown-preview-pane")).toBeNull();
    expect(container.querySelector(".mermaid-preview-pane")).toBeNull();
  });
});

describe("App save entry", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function openEditAndSave() {
    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    const editable = container.querySelector<HTMLElement>(".cm-content");
    await act(async () => {
      if (editable !== null) {
        editable.textContent = "Hello edited";
        editable.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: " edited",
          }),
        );
      }
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLButtonElement>(".save-button")?.disabled).toBe(
      false,
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });
  }

  it("allows a fresh untitled document to enter first save", async () => {
    await act(async () => {
      root.render(<App />);
    });
    const saveButton = container.querySelector<HTMLButtonElement>(".save-button");
    expect(saveButton).not.toBeNull();
    expect(saveButton?.disabled).toBe(false);

    await act(async () => {
      saveButton?.click();
    });
    expect(container.querySelector(".save-as-dialog")).not.toBeNull();
    expect(invokeMock.mock.calls.some((call) => call[0] === "prepare_save_as")).toBe(
      true,
    );
  });

  it("keeps save disabled right after opening a clean file", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    const saveButton = container.querySelector<HTMLButtonElement>(".save-button");
    expect(saveButton?.disabled).toBe(true);
  });

  it("disables open and save while an open is pending", async () => {
    let resolveSelection: ((descriptor: null) => void) | undefined;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "health_check") {
        return Promise.resolve({ service: "document-core", version: "0.1.0" });
      }
      if (cmd === "select_and_open_document") {
        return new Promise<null>((resolve) => {
          resolveSelection = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`));
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    expect(container.querySelector<HTMLButtonElement>(".open-button")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(".save-button")?.disabled).toBe(true);

    await act(async () => {
      resolveSelection?.(null);
    });
  });

  it("save-as shows the inline target, uses bottom-right format, and associates the new target", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-1",
          path: "/tmp/notes.txt",
          displayName: "notes.txt",
          byteCount: 5,
          encoding: "gbk",
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "deadbeef" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "notes.txt",
          directory: { id: "grant-default", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-1",
          path: "/tmp/copy.txt",
          displayName: "copy.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "crlf",
          fingerprint: { sizeBytes: 5, sha256: "new" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    const formatSelects = container.querySelectorAll<HTMLSelectElement>(
      ".format-settings-popover select",
    );
    await act(async () => {
      const encodingSetter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set;
      encodingSetter?.call(formatSelects[0], "utf8");
      formatSelects[0]?.dispatchEvent(new Event("change", { bubbles: true }));
      encodingSetter?.call(formatSelects[1], "crlf");
      formatSelects[1]?.dispatchEvent(new Event("change", { bubbles: true }));
      container
        .querySelector<HTMLButtonElement>(".format-settings-popover .confirm-save")
        ?.click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });

    const chooser = container.querySelector(".save-as-dialog");
    expect(chooser).not.toBeNull();
    expect(container.querySelector('[aria-label="Save file as"]')).not.toBeNull();
    expect(chooser?.textContent).toContain("file name and save location");
    expect(chooser?.textContent).toContain("tmp");
    expect(chooser?.textContent).toContain("UTF-8");
    expect(chooser?.textContent).toContain("CRLF");

    const fileName = chooser?.querySelector<HTMLInputElement>('input[type="text"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(fileName, "copy.txt");
      fileName?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      chooser?.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain("copy.txt");
    expect(container.querySelector(".statusbar")?.textContent).toContain("UTF-8");
    expect(container.querySelector(".statusbar")?.textContent).toContain("CRLF");
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "save_document_as_at"),
    ).toBe(true);
    const saveCall = invokeMock.mock.calls.find(
      (call) => call[0] === "save_document_as_at",
    );
    expect(saveCall?.[2]).toEqual({
      headers: {
        "textora-directory-id": "grant-default",
        "textora-file-name": "copy.txt",
        "textora-encoding": "utf8",
        "textora-line-ending": "crlf",
        "textora-document-id": "doc-1",
      },
    });
    // 对话框已关闭。
    expect(container.querySelector(".save-as-dialog")).toBeNull();
  });

  it("cancels the whole save-as when directory selection is cancelled", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      if (cmd === "pick_save_directory") return null;
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-location-button")
        ?.click();
    });

    expect(container.querySelector(".save-as-dialog")).toBeNull();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "Untitled",
    );
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "preview_save_target"),
    ).toBe(false);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "save_document_as_at"),
    ).toBe(false);
  });

  it("treats Escape as cancelling the inline save-as", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(container.querySelector(".save-as-dialog")).toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "save_document_as_at"),
    ).toBe(false);
  });

  it("asks before replacing an existing different target", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-replace",
          path: "/tmp/notes.txt",
          displayName: "notes.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "notes.txt",
          directory: { id: "grant-replace", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: true, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-replace",
          path: "/tmp/existing.txt",
          displayName: "existing.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "new" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });
    const input = container.querySelector<HTMLInputElement>(
      '.save-as-dialog input[type="text"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "existing.txt");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    expect(container.querySelector(".save-as-replace-warning")).not.toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "save_document_as_at"),
    ).toBe(false);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-replace")
        ?.click();
    });
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document_as_at"),
    ).toHaveLength(1);
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "existing.txt",
    );
  });

  it("rejects save-as when the target is already open in another tab", async () => {
    let openCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        openCount += 1;
        const isFirst = openCount === 1;
        return {
          id: isFirst ? "doc-notes" : "doc-other",
          path: isFirst ? "/tmp/notes.txt" : "/tmp/other.txt",
          displayName: isFirst ? "notes.txt" : "other.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: isFirst ? "notes" : "other" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "other.txt",
          directory: { id: "grant-other", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        expect(args).toMatchObject({
          currentTabId: "tab-3",
          knownDocuments: [
            { tabId: "tab-2", path: "/tmp/notes.txt" },
            { tabId: "tab-3", path: "/tmp/other.txt" },
          ],
        });
        return {
          exists: true,
          isCurrentPath: false,
          occupiedTabId: "tab-2",
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });

    const chooser = container.querySelector(".save-as-dialog");
    const fileName = chooser?.querySelector<HTMLInputElement>('input[type="text"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(fileName, "notes.txt");
      fileName?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      chooser?.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(container.querySelector(".save-as-validation")?.textContent).toContain(
      "already open in another tab",
    );
    expect(container.querySelector(".save-as-replace-warning")).toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "save_document_as_at"),
    ).toBe(false);
  });

  it("skips replacement confirmation for the current original path", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-current",
          path: "/tmp/notes.txt",
          displayName: "notes.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "notes.txt",
          directory: { id: "grant-current", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: true, isCurrentPath: true };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-current",
          path: "/tmp/notes.txt",
          displayName: "notes.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "new" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    expect(container.querySelector(".save-as-replace-warning")).toBeNull();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document_as_at"),
    ).toHaveLength(1);
  });

  it("keeps the panel retryable when the target changes after confirmation", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-race",
          path: "/tmp/race.txt",
          displayName: "race.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "copy.txt",
          directory: { id: "grant-race", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        throw { code: "save-conflict", message: "appeared" };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    expect(container.querySelector(".save-as-dialog")).not.toBeNull();
    expect(container.querySelector(".save-as-validation")?.textContent).toContain(
      "changed on disk",
    );
    expect(
      container.querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.disabled,
    ).toBe(false);
  });

  it("routes a missing current target into the existing missing-file flow", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-missing-save-as",
          path: "/tmp/missing.txt",
          displayName: "missing.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "missing.txt",
          directory: { id: "grant-missing", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: true, isCurrentPath: true };
      }
      if (cmd === "save_document_as_at") {
        throw {
          code: "save-conflict-target-missing",
          message: "missing",
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    expect(container.querySelector(".save-as-dialog")).toBeNull();
    expect(
      container.querySelector('[aria-label="File missing on disk"]'),
    ).not.toBeNull();
  });

  it("keeps reload failure details while leaving the conflict actionable", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-content-changed",
          message: "conflict",
        };
      }
      if (cmd === "reload_from_conflict") {
        throw { code: "file-too-large", message: "too large" };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await openEditAndSave();
    const reload = container.querySelector<HTMLButtonElement>(
      ".notice-action-primary",
    );
    expect(reload).not.toBeNull();
    await act(async () => {
      reload?.click();
    });

    expect(container.querySelector(".notice-conflict-error")?.textContent).toContain(
      "larger than 50 MB",
    );
    expect(
      container.querySelector<HTMLButtonElement>(".notice-action-primary")?.disabled,
    ).toBe(false);
    expect(container.querySelector(".notice-conflict")).not.toBeNull();
  });

  it("commits a successfully reloaded disk snapshot", async () => {
    let contentReads = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        contentReads += 1;
        return new TextEncoder()
          .encode(contentReads === 1 ? "Hello" : "Disk version")
          .buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-content-changed",
          message: "conflict",
        };
      }
      if (cmd === "reload_from_conflict") {
        return {
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "disk" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await openEditAndSave();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-action-primary")
        ?.click();
    });

    expect(container.querySelector(".cm-content")?.textContent).toContain(
      "Disk version",
    );
    expect(container.querySelector(".notice-conflict")).toBeNull();
    expect(container.querySelector(".statusbar")?.textContent).toContain("Saved");
  });

  it("commits a successful force overwrite and clears the conflict", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-content-changed",
          message: "conflict",
        };
      }
      if (cmd === "force_overwrite") {
        return {
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "overwritten" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await openEditAndSave();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-action-danger")
        ?.click();
    });

    expect(
      invokeMock.mock.calls.find((call) => call[0] === "force_overwrite"),
    ).toEqual(["force_overwrite", { id: "doc-conflict" }]);
    expect(container.querySelector(".notice-conflict")).toBeNull();
    expect(container.querySelector(".statusbar")?.textContent).toContain("Saved");
  });

  it("keeps a failed force overwrite actionable with its stable error", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-content-changed",
          message: "conflict",
        };
      }
      if (cmd === "force_overwrite") {
        throw { code: "read-only", message: "read only" };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await openEditAndSave();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-action-danger")
        ?.click();
    });

    expect(container.querySelector(".notice-conflict-error")?.textContent).toContain(
      "read-only",
    );
    expect(container.querySelector(".notice-conflict")).not.toBeNull();
    for (const action of container.querySelectorAll<HTMLButtonElement>(
      ".notice-action",
    )) {
      expect(action.disabled).toBe(false);
    }
  });

  it("serializes all conflict actions while force overwrite is pending", async () => {
    let resolveOverwrite:
      | ((descriptor: {
          id: string;
          path: string;
          displayName: string;
          byteCount: number;
          encoding: { utf8: { bom: boolean } };
          lineEnding: string;
          fingerprint: { sizeBytes: number; sha256: string };
          readOnly: boolean;
        }) => void)
      | undefined;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "health_check") {
        return Promise.resolve({ service: "document-core", version: "0.1.0" });
      }
      if (cmd === "select_and_open_document") {
        return Promise.resolve({
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        });
      }
      if (cmd === "read_document_content") {
        return Promise.resolve(new TextEncoder().encode("Hello").buffer);
      }
      if (cmd === "save_document") {
        return Promise.reject({
          code: "save-conflict-content-changed",
          message: "conflict",
        });
      }
      if (cmd === "force_overwrite") {
        return new Promise((resolve) => {
          resolveOverwrite = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`));
    });

    await openEditAndSave();
    const overwrite = container.querySelector<HTMLButtonElement>(
      ".notice-action-danger",
    );
    await act(async () => {
      overwrite?.click();
    });

    const actions =
      container.querySelectorAll<HTMLButtonElement>(".notice-action");
    for (const action of actions) {
      expect(action.disabled).toBe(true);
      action.click();
    }
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "force_overwrite"),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "cancel_conflict"),
    ).toHaveLength(0);
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "reload_from_conflict"),
    ).toHaveLength(0);

    await act(async () => {
      resolveOverwrite?.({
        id: "doc-conflict",
        path: "/tmp/conflict.txt",
        displayName: "conflict.txt",
        byteCount: 12,
        encoding: { utf8: { bom: false } },
        lineEnding: "lf",
        fingerprint: { sizeBytes: 12, sha256: "overwritten" },
        readOnly: false,
      });
    });
    expect(container.querySelector(".notice-conflict")).toBeNull();
  });

  it("serializes conflict actions while cancellation is pending", async () => {
    let resolveCancel: (() => void) | undefined;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "health_check") {
        return Promise.resolve({ service: "document-core", version: "0.1.0" });
      }
      if (cmd === "select_and_open_document") {
        return Promise.resolve({
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        });
      }
      if (cmd === "read_document_content") {
        return Promise.resolve(new TextEncoder().encode("Hello").buffer);
      }
      if (cmd === "save_document") {
        return Promise.reject({
          code: "save-conflict-content-changed",
          message: "conflict",
        });
      }
      if (cmd === "cancel_conflict") {
        return new Promise<void>((resolve) => {
          resolveCancel = resolve;
        });
      }
      if (cmd === "reload_from_conflict") {
        return Promise.reject(new Error("reload must stay disabled"));
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`));
    });

    await openEditAndSave();
    const actions = container.querySelectorAll<HTMLButtonElement>(".notice-action");
    await act(async () => {
      actions[0]?.click();
    });

    expect(actions[0]?.disabled).toBe(true);
    expect(actions[1]?.disabled).toBe(true);
    actions[1]?.click();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "reload_from_conflict"),
    ).toHaveLength(0);

    await act(async () => {
      resolveCancel?.();
    });
    expect(container.querySelector(".notice-conflict")).toBeNull();
  });

  it("treats Escape as cancelling a content conflict", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-content-changed",
          message: "conflict",
        };
      }
      if (cmd === "cancel_conflict") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await openEditAndSave();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "cancel_conflict"),
    ).toHaveLength(1);
    expect(container.querySelector(".notice-conflict")).toBeNull();
  });

  it("skips focus checks for Untitled and while an open is pending", async () => {
    let resolveSelection: ((descriptor: null) => void) | undefined;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "health_check") {
        return Promise.resolve({ service: "document-core", version: "0.1.0" });
      }
      if (cmd === "select_and_open_document") {
        return new Promise<null>((resolve) => {
          resolveSelection = resolve;
        });
      }
      if (cmd === "refresh_external_document") {
        return Promise.reject(
          new Error("external refresh must not run in this state"),
        );
      }
      return Promise.reject(new Error(`unexpected invoke ${cmd}`));
    });

    await act(async () => root.render(<App />));
    await emitWindowFocus();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await emitWindowFocus();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "refresh_external_document"),
    ).toHaveLength(0);

    await act(async () => {
      resolveSelection?.(null);
    });
  });

  it("keeps the session on an existence-check error and retries on next focus", async () => {
    let checkCount = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-retry",
          path: "/tmp/retry.txt",
          displayName: "retry.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "refresh_external_document") {
        return { documentId: "doc-retry", kind: "missing" };
      }
      if (cmd === "check_target_exists") {
        checkCount += 1;
        if (checkCount === 1) {
          throw { code: "read-failed", message: "permission denied" };
        }
        return false;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await emitWindowFocus();
    await vi.waitFor(() => expect(checkCount).toBe(1));
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "retry.txt",
    );

    await emitWindowFocus();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[aria-label="File missing on disk"]'),
      ).not.toBeNull();
    });
    expect(checkCount).toBe(2);
  });

  it("deduplicates focus refreshes while one is already running", async () => {
    let resolveRefresh: ((change: null) => void) | undefined;
    invokeMock.mockImplementation(
      (cmd: string, args?: { id?: string }) => {
        if (cmd === "health_check") {
          return Promise.resolve({ service: "document-core", version: "0.1.0" });
        }
        if (cmd === "select_and_open_document") {
          return Promise.resolve({
            id: "doc-focus",
            path: "/tmp/focus.txt",
            displayName: "focus.txt",
            byteCount: 1,
            encoding: { utf8: { bom: false } },
            lineEnding: "lf",
            fingerprint: { sizeBytes: 1, sha256: "focus" },
            readOnly: false,
          });
        }
        if (cmd === "read_document_content") {
          return Promise.resolve(new TextEncoder().encode(args?.id).buffer);
        }
        if (cmd === "refresh_external_document") {
          return new Promise<null>((resolve) => {
            resolveRefresh = resolve;
          });
        }
        return Promise.reject(new Error(`unexpected invoke ${cmd}`));
      },
    );

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await emitWindowFocus();
    await emitWindowFocus();
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "refresh_external_document"),
    ).toHaveLength(1);

    await act(async () => {
      resolveRefresh?.(null);
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "focus.txt",
    );
  });

  it("treats Escape on a missing-file prompt as keeping the content", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-missing",
          path: "/tmp/missing.txt",
          displayName: "missing.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "refresh_external_document") {
        return { documentId: "doc-missing", kind: "missing" };
      }
      if (cmd === "check_target_exists") {
        return false;
      }
      if (cmd === "close_document") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await emitWindowFocus();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[aria-label="File missing on disk"]'),
      ).not.toBeNull();
    });

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(
      invokeMock.mock.calls.find((call) => call[0] === "close_document"),
    ).toEqual(["close_document", { id: "doc-missing" }]);
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "missing.txt",
    );
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });
    expect(container.querySelector(".save-as-dialog")).not.toBeNull();
  });

  it("keeps the missing prompt on close failure and discards only after success", async () => {
    let closeAttempts = 0;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-missing",
          path: "/tmp/missing.txt",
          displayName: "missing.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "refresh_external_document") {
        return { documentId: "doc-missing", kind: "missing" };
      }
      if (cmd === "check_target_exists") {
        return false;
      }
      if (cmd === "close_document") {
        closeAttempts += 1;
        if (closeAttempts === 1) {
          throw { code: "unknown-document", message: "stale" };
        }
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await emitWindowFocus();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[aria-label="File missing on disk"]'),
      ).not.toBeNull();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-cancel")?.click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be detached",
    );
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "missing.txt",
    );
    expect(
      container.querySelector<HTMLButtonElement>(".confirm-discard")?.disabled,
    ).toBe(false);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-discard")?.click();
    });
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "Untitled",
    );
  });

  it("routes a normal save missing conflict to the same safe prompt", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-missing",
          path: "/tmp/missing.txt",
          displayName: "missing.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-target-missing",
          message: "missing",
        };
      }
      if (cmd === "close_document") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await openEditAndSave();
    expect(
      container.querySelector('[aria-label="File missing on disk"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector<HTMLElement>(".cm-content")
        ?.getAttribute("contenteditable"),
    ).toBe("false");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-cancel")?.click();
    });
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
  });

  it("re-detects the language from the new path after saving as a different extension", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "Untitled",
          directory: { id: "grant-default", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "untitled-1",
          path: "/tmp/saved.ts",
          displayName: "saved.ts",
          byteCount: 0,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 0, sha256: "new" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    expect(container.querySelector(".statusbar-language")?.textContent).toBe("Plain Text");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });
    const chooser = container.querySelector(".save-as-dialog");
    const fileName = chooser?.querySelector<HTMLInputElement>('input[type="text"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(fileName, "saved.ts");
      fileName?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      chooser?.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "saved.ts",
    );
    expect(container.querySelector(".statusbar-language")?.textContent).toBe("TypeScript");
  });
});

describe("App Markdown preview", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not show the Preview toggle for non-Markdown documents", async () => {
    await act(async () => root.render(<App />));

    expect(container.querySelector(".markdown-preview-toggle")).toBeNull();
    expect(container.querySelector(".markdown-wysiwyg-toggle")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".statusbar-language")?.textContent).toBe(
        "Plain Text",
      );
    });
    expect(container.querySelector(".markdown-preview-toggle")).toBeNull();
    expect(container.querySelector(".markdown-wysiwyg-toggle")).toBeNull();
    expect(container.querySelector(".markdown-preview-pane")).toBeNull();
  });

  it("opens WYSIWYG mode, exits it through Preview, and keeps the source editable state per tab", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: 64,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 64, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("# Title\n\nBody").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".statusbar-language")?.textContent).toBe(
        "Markdown",
      );
    });
    expect(container.querySelector(".markdown-wysiwyg-toggle")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")?.click();
    });

    expect(container.querySelector(".markdown-wysiwyg-editor")).not.toBeNull();
    expect(container.querySelector(".editor-source-pane")).toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-preview-toggle")?.click();
    });

    expect(container.querySelector(".markdown-wysiwyg-editor")).toBeNull();
    expect(container.querySelector(".markdown-preview-pane")).not.toBeNull();
    expect(
      container
        .querySelector<HTMLButtonElement>(".markdown-preview-toggle")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    expect(container.querySelector(".markdown-wysiwyg-toggle")).toBeNull();

    const markdownTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select"),
    ).find((button) => button.textContent?.includes("README.md"));
    await act(async () => {
      markdownTab?.click();
    });

    expect(container.querySelector(".markdown-preview-pane")).not.toBeNull();
    expect(container.querySelector(".markdown-wysiwyg-editor")).toBeNull();
  });

  it("syncs the preview to the editor scroll when Markdown preview is visible", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: 64,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 64, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("# Title\n\nParagraph here.\n\n- item").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      await act(async () => root.render(<App />));
      await act(async () => {
        container.querySelector<HTMLButtonElement>(".open-button")?.click();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>(".markdown-preview-toggle")?.click();
      });
      const previewContent = container.querySelector<HTMLElement>(
        ".markdown-preview-content",
      );
      expect(previewContent).not.toBeNull();
      const previewPane = container.querySelector<HTMLElement>(
        ".markdown-preview-pane",
      );
      expect(previewPane).not.toBeNull();
      Object.defineProperty(previewPane!, "scrollTop", {
        configurable: true,
        writable: true,
        value: 0,
      });
      vi.spyOn(previewPane!, "getBoundingClientRect").mockReturnValue({
        top: 0,
      } as DOMRect);
      const rectSpies = Array.from(previewContent!.children).map((child) =>
        vi
          .spyOn(child as HTMLElement, "getBoundingClientRect")
          .mockReturnValue({ top: 120 } as DOMRect),
      );

      const scroller = container.querySelector<HTMLElement>(".cm-scroller");
      expect(scroller).not.toBeNull();
      await act(async () => {
        scroller!.scrollTop = 40;
        scroller!.dispatchEvent(new Event("scroll"));
      });

      // 源码→预览跟随：预览某个顶层块被滚动到顶部（具体块取决于 CodeMirror 的行高估算）。
      expect(previewPane!.scrollTop).toBeGreaterThan(0);
      for (const spy of rectSpies) {
        spy.mockRestore();
      }
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("does not sync the preview for a non-Markdown document", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    try {
      await act(async () => root.render(<App />));
      // 默认 Untitled 为纯文本：无 Preview，同步应被跳过。
      expect(container.querySelector(".markdown-preview-content")).toBeNull();
      scrollIntoView.mockClear();

      const scroller = container.querySelector<HTMLElement>(".cm-scroller");
      expect(scroller).not.toBeNull();
      await act(async () => {
        scroller!.scrollTop = 40;
        scroller!.dispatchEvent(new Event("scroll"));
      });

      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it("scrolls the editor to the source line when the preview is scrolled", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: 64,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 64, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("# Title\n\nParagraph here.\n\n- item").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    const cmScrollSpy = vi.spyOn(EditorView, "scrollIntoView");
    try {
      await act(async () => root.render(<App />));
      await act(async () => {
        container.querySelector<HTMLButtonElement>(".open-button")?.click();
      });
      await act(async () => {
        container.querySelector<HTMLButtonElement>(".markdown-preview-toggle")?.click();
      });
      const pane = container.querySelector<HTMLElement>(".markdown-preview-pane");
      expect(pane).not.toBeNull();
      cmScrollSpy.mockClear();

      await act(async () => {
        pane!.dispatchEvent(new Event("scroll"));
      });

      // 预览→源码跟随：源码编辑区被请求滚动到对应源码块。
      expect(cmScrollSpy).toHaveBeenCalled();
      Object.defineProperty(pane!, "scrollTop", {
        configurable: true,
        writable: true,
        value: 0,
      });
      vi.spyOn(pane!, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
      const previewContent = container.querySelector<HTMLElement>(
        ".markdown-preview-content",
      );
      expect(previewContent).not.toBeNull();
      const rectSpies = Array.from(previewContent!.children).map((child) =>
        vi
          .spyOn(child as HTMLElement, "getBoundingClientRect")
          .mockReturnValue({ top: 120 } as DOMRect),
      );

      const scroller = container.querySelector<HTMLElement>(".cm-scroller");
      expect(scroller).not.toBeNull();
      await act(async () => {
        scroller!.scrollTop = 40;
        scroller!.dispatchEvent(new Event("scroll"));
      });

      // 若预览→源码没有实际产生源码 scroll 事件，程序滚动标记也应在下一帧兜底复位；
      // 后续用户主动滚动源码时，源码→预览同步不能被误吞。
      expect(pane!.scrollTop).toBeGreaterThan(0);
      for (const spy of rectSpies) {
        spy.mockRestore();
      }
    } finally {
      rafSpy.mockRestore();
      cmScrollSpy.mockRestore();
    }
  });

  it("edits Markdown through WYSIWYG and saves Markdown source text", async () => {
    let savedContent = "";
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: 64,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 64, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder()
          .encode(
            '# Title\n\nParagraph\n\n- [ ] item\n\n> quoted\n\n```json\n{"ok":true}\n```',
          )
          .buffer;
      }
      if (cmd === "save_document") {
        savedContent = new TextDecoder().decode(args as Uint8Array);
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: savedContent.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: savedContent.length, sha256: "saved" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".statusbar-language")?.textContent).toBe(
        "Markdown",
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")?.click();
    });

    const headingText = container.querySelector(
      ".markdown-wysiwyg-heading .wysiwyg-inline-text",
    );
    await act(async () => {
      if (headingText) {
        headingText.textContent = "Edited";
        headingText.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    });

    const paragraphText = container.querySelector(
      ".markdown-wysiwyg-paragraph .wysiwyg-inline-text",
    );
    await act(async () => {
      if (paragraphText) {
        paragraphText.textContent = "Updated paragraph";
        paragraphText.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    });

    await act(async () => {
      container.querySelector<HTMLInputElement>("input[aria-label='Task 1']")?.click();
    });

    const blockquoteText = container.querySelector(
      ".markdown-wysiwyg-blockquote .wysiwyg-inline-text",
    );
    await act(async () => {
      if (blockquoteText) {
        blockquoteText.textContent = "updated quote";
        blockquoteText.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    });

    const code = container.querySelector<HTMLTextAreaElement>(
      ".markdown-wysiwyg-code",
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(code, '{ "ok": false }');
      code?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")?.click();
    });

    expect(container.querySelector(".markdown-wysiwyg-editor")).toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain(
      "# Edited",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });

    expect(savedContent).toBe(
      '# Edited\n\nUpdated paragraph\n\n- [x] item\n\n> updated quote\n\n```json\n{ "ok": false }\n```',
    );
    expect(savedContent).not.toContain("markdown-wysiwyg");
    expect(savedContent).not.toContain("<input");
  });

  it("shows and edits inline formatting in WYSIWYG list items and saves source", async () => {
    let savedContent = "";
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md-inline",
          path: "/tmp/notes.md",
          displayName: "notes.md",
          byteCount: 64,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 64, sha256: "md-inline" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder()
          .encode("- **状态**：待开始\n- 参考 `docs/tasks/current.md`")
          .buffer;
      }
      if (cmd === "save_document") {
        savedContent = new TextDecoder().decode(args as Uint8Array);
        return {
          id: "doc-md-inline",
          path: "/tmp/notes.md",
          displayName: "notes.md",
          byteCount: savedContent.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: savedContent.length, sha256: "saved" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".statusbar-language")?.textContent).toBe(
        "Markdown",
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")?.click();
    });

    const bold = container.querySelector(
      ".markdown-wysiwyg-list-text .wysiwyg-inline-bold",
    );
    const code = container.querySelector(
      ".markdown-wysiwyg-list-text .wysiwyg-inline-code",
    );
    expect(bold?.textContent).toBe("状态");
    expect(code?.textContent).toBe("docs/tasks/current.md");
    expect(
      container.querySelector(".markdown-wysiwyg-list-text .wysiwyg-inline-run")
        ?.textContent,
    ).toBe("状态：待开始");

    await act(async () => {
      if (bold) {
        bold.textContent = "进度";
        bold.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });

    expect(savedContent).toBe(
      "- **进度**：待开始\n- 参考 `docs/tasks/current.md`",
    );
    expect(savedContent).not.toContain("<span");
  });

  it("locks WYSIWYG fields for read-only Markdown documents", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md-readonly",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "md-readonly" },
          readOnly: true,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("# Locked").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".statusbar-language")?.textContent).toBe(
        "Markdown",
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")?.click();
    });

    expect(
      container.querySelector(
        ".markdown-wysiwyg-heading .wysiwyg-inline-run > span",
      )?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(container.querySelector(".readonly-badge")?.textContent).toBe(
      "Read-only",
    );
  });

  it("opens a per-tab Markdown split preview and updates it from source edits", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: 64,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 64, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(
          "# Title\n\n![diagram](https://example.com/a.png)\n\n<script>bad()</script>",
        ).buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".statusbar-language")?.textContent).toBe(
        "Markdown",
      );
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      ".markdown-preview-toggle",
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      toggle?.click();
    });

    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".markdown-preview-pane")).not.toBeNull();
    expect(container.querySelector(".markdown-preview-content")?.innerHTML).toContain(
      "<h1>Title</h1>",
    );
    expect(container.querySelector(".markdown-preview-content")?.innerHTML).toContain(
      "markdown-preview-image-placeholder",
    );
    expect(container.querySelector(".markdown-preview-content")?.innerHTML).not.toContain(
      "<img",
    );
    expect(container.querySelector(".markdown-preview-content")?.innerHTML).not.toContain(
      "<script>",
    );

    const editable = container.querySelector<HTMLElement>(".cm-content");
    await act(async () => {
      if (editable === null) throw new Error("missing editor");
      editable.textContent = "## Updated\n\n- [x] done";
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "## Updated\n\n- [x] done",
        }),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector(".markdown-preview-content")?.innerHTML,
      ).toContain("<h2>Updated</h2>");
    });
    const taskCheckbox = container.querySelector<HTMLInputElement>(
      ".markdown-preview-content input[type='checkbox']",
    );
    expect(taskCheckbox?.disabled).toBe(true);
    expect(taskCheckbox?.checked).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    expect(container.querySelector(".statusbar-language")?.textContent).toBe(
      "Plain Text",
    );
    expect(container.querySelector(".markdown-preview-toggle")).toBeNull();
    expect(container.querySelector(".markdown-preview-pane")).toBeNull();

    const markdownTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select"),
    ).find((button) => button.textContent?.includes("README.md"));
    await act(async () => {
      markdownTab?.click();
    });

    expect(container.querySelector(".statusbar-language")?.textContent).toBe(
      "Markdown",
    );
    expect(
      container
        .querySelector<HTMLButtonElement>(".markdown-preview-toggle")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.querySelector(".markdown-preview-pane")).not.toBeNull();
  });

  it("renders Mermaid fenced code blocks inside Markdown preview", async () => {
    const markdownSource = `# Flow

\`\`\`mermaid
flowchart TD
A-->B
\`\`\`

\`\`\`ts
const kept = true;
\`\`\`
`;
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: markdownSource.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: markdownSource.length, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(markdownSource).buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-preview-toggle")?.click();
    });

    expect(container.querySelector(".markdown-mermaid-preview")).not.toBeNull();
    expect(container.querySelector(".markdown-preview-content")?.innerHTML).toContain(
      "language-ts",
    );
    await vi.waitFor(() => {
      expect(mermaidPreviewMock.renderMermaidPreview).toHaveBeenCalledWith(
        "flowchart TD\nA-->B",
      );
      expect(container.querySelector(".markdown-mermaid-preview")?.innerHTML).toContain(
        "A--&gt;B",
      );
    });
  });

  it("shows Mermaid fenced code block errors in place without locking Markdown editing", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: 20,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 20, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder()
          .encode("```mermaid\nflowchart TD\nBROKEN\n```")
          .buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-preview-toggle")?.click();
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".markdown-mermaid-preview.is-error")).not.toBeNull();
      expect(container.querySelector(".markdown-mermaid-preview")?.textContent).toContain(
        "mock Mermaid syntax error",
      );
    });
    expect(
      container
        .querySelector<HTMLElement>(".cm-content")
        ?.getAttribute("contenteditable"),
    ).toBe("true");
  });

  it("saves Markdown source text while Mermaid fenced preview is rendered", async () => {
    const markdownSource = `# Flow

\`\`\`mermaid
flowchart TD
A-->B
\`\`\`

\`\`\`ts
const answer = 42;
\`\`\`
`;
    let savedContent = "";
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: markdownSource.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: markdownSource.length, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(markdownSource).buffer;
      }
      if (cmd === "save_document") {
        savedContent = new TextDecoder().decode(args as Uint8Array);
        return {
          id: "doc-md",
          path: "/tmp/README.md",
          displayName: "README.md",
          byteCount: savedContent.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: savedContent.length, sha256: "saved" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-preview-toggle")?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".markdown-mermaid-preview")?.innerHTML).toContain(
        "A--&gt;B",
      );
      expect(container.querySelector(".markdown-preview-content")?.innerHTML).toContain(
        "tok-keyword",
      );
    });

    const nextSource = markdownSource.replace("A-->B", "A-->Saved");
    const editable = container.querySelector<HTMLElement>(".cm-content");
    await act(async () => {
      if (editable === null) throw new Error("missing editor");
      editable.textContent = nextSource;
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: nextSource,
        }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });

    expect(savedContent).toBe(nextSource);
    expect(savedContent).not.toContain("<svg");
    expect(savedContent).not.toContain("mock-mermaid");
    expect(savedContent).not.toContain("tok-keyword");
  });
});

describe("App Mermaid preview", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function mockOpenMermaidDocument(initialContent: string) {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-mermaid",
          path: "/tmp/diagram.mmd",
          displayName: "diagram.mmd",
          byteCount: initialContent.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: initialContent.length, sha256: "mmd" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(initialContent).buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
  }

  it("opens a per-tab Mermaid split preview and updates it after source edits", async () => {
    mockOpenMermaidDocument("flowchart TD\nA-->B");

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".statusbar-language")?.textContent).toBe(
        "Mermaid",
      );
    });
    const toggle = container.querySelector<HTMLButtonElement>(
      ".mermaid-preview-toggle",
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      toggle?.click();
    });

    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".mermaid-preview-pane")).not.toBeNull();
    expect(container.querySelector(".mermaid-preview-loading")).not.toBeNull();

    await vi.waitFor(() => {
      expect(mermaidPreviewMock.renderMermaidPreview).toHaveBeenCalledWith(
        "flowchart TD\nA-->B",
      );
      expect(container.querySelector(".mermaid-preview-content")?.innerHTML).toContain(
        "A--&gt;B",
      );
    });

    const editable = container.querySelector<HTMLElement>(".cm-content");
    await act(async () => {
      if (editable === null) throw new Error("missing editor");
      editable.textContent = "flowchart TD\nA-->C";
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "flowchart TD\nA-->C",
        }),
      );
      await Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(mermaidPreviewMock.renderMermaidPreview).toHaveBeenCalledWith(
        "flowchart TD\nA-->C",
      );
      expect(container.querySelector(".mermaid-preview-content")?.innerHTML).toContain(
        "A--&gt;C",
      );
    });
  });

  it("shows Mermaid render errors without blocking editing", async () => {
    mockOpenMermaidDocument("flowchart TD\nBROKEN");

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".mermaid-preview-toggle")?.click();
    });

    await vi.waitFor(() => {
      expect(container.querySelector(".mermaid-preview-pane.is-error")).not.toBeNull();
      expect(container.querySelector(".mermaid-preview-content")?.textContent).toContain(
        "mock Mermaid syntax error",
      );
    });

    const editable = container.querySelector<HTMLElement>(".cm-content");
    expect(editable?.getAttribute("contenteditable")).toBe("true");
  });

  it("saves Mermaid source text while preview is open, not the rendered SVG", async () => {
    const initialContent = "flowchart TD\nA-->B";
    let savedDescriptorContent = "";
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-mermaid",
          path: "/tmp/diagram.mmd",
          displayName: "diagram.mmd",
          byteCount: initialContent.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: initialContent.length, sha256: "mmd" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(initialContent).buffer;
      }
      if (cmd === "save_document") {
        savedDescriptorContent = new TextDecoder().decode(args as Uint8Array);
        return {
          id: "doc-mermaid",
          path: "/tmp/diagram.mmd",
          displayName: "diagram.mmd",
          byteCount: savedDescriptorContent.length,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: savedDescriptorContent.length, sha256: "saved" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".mermaid-preview-toggle")?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".mermaid-preview-content")?.innerHTML).toContain(
        "A--&gt;B",
      );
    });

    const nextSource = "flowchart TD\nA-->Saved";
    const editable = container.querySelector<HTMLElement>(".cm-content");
    await act(async () => {
      if (editable === null) throw new Error("missing editor");
      editable.textContent = nextSource;
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: nextSource,
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });

    expect(savedDescriptorContent).toBe(nextSource);
    expect(savedDescriptorContent).not.toContain("<svg");
    expect(savedDescriptorContent).not.toContain("mock-mermaid");
  });

  it("keeps Mermaid preview state isolated across tab switches", async () => {
    mockOpenMermaidDocument("flowchart TD\nA-->B");

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".mermaid-preview-toggle")?.click();
    });
    await vi.waitFor(() => {
      expect(container.querySelector(".mermaid-preview-content")?.innerHTML).toContain(
        "A--&gt;B",
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    expect(container.querySelector(".statusbar-language")?.textContent).toBe(
      "Plain Text",
    );
    expect(container.querySelector(".mermaid-preview-toggle")).toBeNull();
    expect(container.querySelector(".mermaid-preview-pane")).toBeNull();

    const mermaidTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select"),
    ).find((button) => button.textContent?.includes("diagram.mmd"));
    await act(async () => {
      mermaidTab?.click();
    });

    expect(container.querySelector(".statusbar-language")?.textContent).toBe(
      "Mermaid",
    );
    expect(
      container
        .querySelector<HTMLButtonElement>(".mermaid-preview-toggle")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.querySelector(".mermaid-preview-pane")).not.toBeNull();
  });
});

describe("App window close protection", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderAndEdit(openDocument = true) {
    await act(async () => root.render(<App />));
    if (openDocument) {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(".open-button")?.click();
      });
    }
    const editable = container.querySelector<HTMLElement>(".cm-content");
    await act(async () => {
      if (editable !== null) {
        editable.textContent = openDocument ? "Hello edited" : "Draft";
        editable.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: openDocument ? " edited" : "Draft",
          }),
        );
      }
      await Promise.resolve();
    });
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
  }

  function editActiveContent(content: string) {
    const editable = container.querySelector<HTMLElement>(".cm-content");
    if (editable === null) throw new Error("missing editor");
    editable.textContent = content;
    editable.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: content,
      }),
    );
  }

  function activeTabTitle() {
    return (
      container.querySelector(".document-tab.is-active")?.textContent ?? ""
    );
  }

  function tabTitles() {
    return Array.from(container.querySelectorAll(".document-tab-title")).map(
      (node) => node.textContent,
    );
  }

  async function renderTwoDirtyUntitledTabs() {
    await act(async () => root.render(<App />));
    await act(async () => editActiveContent("first dirty"));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    await act(async () => editActiveContent("second dirty"));
    expect(tabTitles()).toEqual(["Untitled", "Untitled 2"]);
  }

  async function renderTwoDirtyOpenedTabs() {
    let selectionCount = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: { id?: string }) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        selectionCount += 1;
        const suffix = selectionCount === 1 ? "a" : "b";
        return {
          id: `doc-${suffix}`,
          path: `/tmp/${suffix}.txt`,
          displayName: `${suffix}.txt`,
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: suffix },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder()
          .encode(args?.id === "doc-b" ? "Second" : "First")
          .buffer;
      }
      if (cmd === "save_document") {
        return {
          id: args?.id ?? "doc-a",
          path: `/tmp/${args?.id === "doc-b" ? "b" : "a"}.txt`,
          displayName: `${args?.id === "doc-b" ? "b" : "a"}.txt`,
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "saved" },
          readOnly: false,
        };
      }
      if (cmd === "close_document" || cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => editActiveContent("first edited"));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => editActiveContent("second edited"));
    expect(tabTitles()).toEqual(["Untitled", "a.txt", "b.txt"]);
  }

  it("hides a clean window close without a confirmation", async () => {
    await act(async () => root.render(<App />));

    const preventDefault = await emitWindowClose();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(tauriWindowMock.hide).toHaveBeenCalledOnce();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
  });

  it("keeps one confirmation for repeated requests and Escape cancels it", async () => {
    await renderAndEdit();

    const first = await emitWindowClose();
    const second = await emitWindowClose();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(
      container.querySelectorAll('[aria-label="Save before closing?"]'),
    ).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );

    const retried = await emitWindowClose();
    expect(retried).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).not.toBeNull();
  });

  it("walks dirty tabs one by one on window close and cancel stops the remaining queue", async () => {
    await renderTwoDirtyUntitledTabs();

    const firstClose = await emitWindowClose();
    const secondClose = await emitWindowClose();

    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).toHaveBeenCalledOnce();
    expect(activeTabTitle()).toContain("Untitled");
    expect(
      container.querySelector('[aria-label="Save before closing?"]')?.textContent,
    ).toContain("Untitled");
    expect(
      container.querySelectorAll('[aria-label="Save before closing?"]'),
    ).toHaveLength(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-discard")?.click();
    });

    expect(tabTitles()).toEqual(["Untitled 2"]);
    expect(activeTabTitle()).toContain("Untitled 2");
    expect(
      container.querySelector('[aria-label="Save before closing?"]')?.textContent,
    ).toContain("Untitled 2");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-cancel")?.click();
    });

    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
    expect(tabTitles()).toEqual(["Untitled 2"]);
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("finishes an app-exit queue only after every dirty tab is handled", async () => {
    await renderTwoDirtyOpenedTabs();

    await emitAppExitRequest();
    expect(activeTabTitle()).toContain("a.txt");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });
    expect(activeTabTitle()).toContain("b.txt");
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-discard")?.click();
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document"),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.find((call) => call[0] === "close_document"),
    ).toEqual(["close_document", { id: "doc-b" }]);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(true);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("stops a multi-tab app-exit queue when saving one tab fails", async () => {
    await renderTwoDirtyOpenedTabs();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "save_document") {
        throw { code: "save-failed", message: "failed" };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await emitAppExitRequest();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(container.querySelector(".notice-error")).not.toBeNull();
    expect(activeTabTitle()).toContain("a.txt");
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
    expect(tabTitles()).toEqual(["Untitled", "a.txt", "b.txt"]);
  });

  it("hides the window after explicitly discarding dirty content", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-discard",
          path: "/tmp/discard.txt",
          displayName: "discard.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "close_document") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitWindowClose();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".confirm-discard")
        ?.click();
    });

    expect(
      invokeMock.mock.calls.find((call) => call[0] === "close_document"),
    ).toEqual(["close_document", { id: "doc-discard" }]);
    expect(tauriWindowMock.hide).toHaveBeenCalledOnce();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(tauriWindowMock.allowedCloseCount).toBe(0);
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
  });

  it("saves an opened document and hides the window", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-save-close",
          path: "/tmp/save-close.txt",
          displayName: "save-close.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        return {
          id: "doc-save-close",
          path: "/tmp/save-close.txt",
          displayName: "save-close.txt",
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "saved" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitWindowClose();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document"),
    ).toHaveLength(1);
    expect(tauriWindowMock.hide).toHaveBeenCalledOnce();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(tauriWindowMock.allowedCloseCount).toBe(0);
  });

  it("does not issue a delayed close authorization after saving before hiding", async () => {
    let selectionCount = 0;
    tauriWindowMock.deferCloseEvent = true;
    invokeMock.mockImplementation(
      async (cmd: string, args?: { id?: string }) => {
        if (cmd === "health_check") {
          return { service: "document-core", version: "0.1.0" };
        }
        if (cmd === "select_and_open_document") {
          selectionCount += 1;
          const suffix = selectionCount === 1 ? "a" : "b";
          return {
            id: `doc-${suffix}`,
            path: `/tmp/${suffix}.txt`,
            displayName: `${suffix}.txt`,
            byteCount: 5,
            encoding: { utf8: { bom: false } },
            lineEnding: "lf",
            fingerprint: { sizeBytes: 5, sha256: suffix },
            readOnly: false,
          };
        }
        if (cmd === "read_document_content") {
          return new TextEncoder()
            .encode(args?.id === "doc-b" ? "Second" : "Hello")
            .buffer;
        }
        if (cmd === "save_document") {
          return {
            id: "doc-a",
            path: "/tmp/a.txt",
            displayName: "a.txt",
            byteCount: 12,
            encoding: { utf8: { bom: false } },
            lineEnding: "lf",
            fingerprint: { sizeBytes: 12, sha256: "saved" },
            readOnly: false,
          };
        }
        throw new Error(`unexpected invoke ${cmd}`);
      },
    );
    await renderAndEdit();
    await emitWindowClose();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });
    expect(tauriWindowMock.pendingProgrammaticClose).toBeUndefined();
    expect(tauriWindowMock.hide).toHaveBeenCalledOnce();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "b.txt",
    );

    await act(async () => {
      await tauriWindowMock.pendingProgrammaticClose?.();
    });
    expect(tauriWindowMock.allowedCloseCount).toBe(0);
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "b.txt",
    );
  });

  it("routes a close-time content conflict without closing or staying busy", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-close-conflict",
          path: "/tmp/conflict.txt",
          displayName: "conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-content-changed",
          message: "conflict",
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitWindowClose();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(container.querySelector(".notice-conflict")).not.toBeNull();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLElement>(".cm-content")?.getAttribute(
        "contenteditable",
      ),
    ).toBe("false");
  });

  it("continues an Untitled first save into the authorized close", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      if (cmd === "pick_save_directory") {
        return { id: "grant-close", displayName: "tmp" };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-first-save",
          path: "/tmp/draft.txt",
          displayName: "draft.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "saved" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit(false);
    await emitWindowClose();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });
    expect(container.querySelector(".save-as-dialog")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .save-as-location-button")
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document_as_at"),
    ).toHaveLength(1);
    expect(tauriWindowMock.hide).toHaveBeenCalledOnce();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(tauriWindowMock.allowedCloseCount).toBe(0);
  });

  it("cancels the close intent when the format chooser is cancelled", async () => {
    await renderAndEdit(false);
    await emitWindowClose();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-cancel")
        ?.click();
    });

    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
    const retried = await emitWindowClose();
    expect(retried).toHaveBeenCalledOnce();
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).not.toBeNull();
  });

  it("cancels the close intent when directory selection is cancelled", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      if (cmd === "pick_save_directory") {
        return null;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit(false);
    await emitWindowClose();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .save-as-location-button")
        ?.click();
    });

    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
    const retried = await emitWindowClose();
    expect(retried).toHaveBeenCalledOnce();
  });

  it("routes a close-time missing target and never closes after resolving it", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-close-missing",
          path: "/tmp/missing.txt",
          displayName: "missing.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw {
          code: "save-conflict-target-missing",
          message: "missing",
        };
      }
      if (cmd === "close_document") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitWindowClose();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(
      container.querySelector('[aria-label="File missing on disk"]'),
    ).not.toBeNull();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-cancel")?.click();
    });
    expect(
      container.querySelector('[aria-label="File missing on disk"]'),
    ).toBeNull();
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
  });

  it("exits directly when an app-exit request arrives for a clean document", async () => {
    await act(async () => root.render(<App />));

    await emitAppExitRequest();

    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(true);
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
  });

  it("prompts once for an app-exit request on a dirty document and cancel keeps it alive", async () => {
    await renderAndEdit();

    await emitAppExitRequest();

    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
  });

  it("protects a dirty document from the exit event without pre-arming any guard", async () => {
    await renderAndEdit();

    await emitAppExitRequest();

    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).not.toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
    // 保护不依赖任何异步武装 IPC：前端从不调用 set_exit_guard，消除时序窗口。
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "set_exit_guard"),
    ).toBe(false);
  });

  it("keeps one confirmation for repeated app-exit requests", async () => {
    await renderAndEdit();

    await emitAppExitRequest();
    await emitAppExitRequest();

    expect(
      container.querySelectorAll('[aria-label="Save before closing?"]'),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
  });

  it("blocks an app-exit request while another interaction is busy", async () => {
    await renderAndEdit(false);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-button")?.click();
    });
    expect(container.querySelector(".save-as-dialog")).not.toBeNull();

    await emitAppExitRequest();

    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
  });

  it("blocks a window close that arrives during an app-exit intent", async () => {
    await renderAndEdit();
    await emitAppExitRequest();

    const preventDefault = await emitWindowClose();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(
      container.querySelectorAll('[aria-label="Save before closing?"]'),
    ).toHaveLength(1);
  });

  it("upgrades a window-close intent to an app exit and completes via request_app_exit", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-exit-save",
          path: "/tmp/exit-save.txt",
          displayName: "exit-save.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        return {
          id: "doc-exit-save",
          path: "/tmp/exit-save.txt",
          displayName: "exit-save.txt",
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "saved" },
          readOnly: false,
        };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitWindowClose();
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document"),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(true);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("exits via request_app_exit after saving on a direct app-exit intent", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-exit-direct",
          path: "/tmp/exit-direct.txt",
          displayName: "exit-direct.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        return {
          id: "doc-exit-direct",
          path: "/tmp/exit-direct.txt",
          displayName: "exit-direct.txt",
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "saved" },
          readOnly: false,
        };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document"),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(true);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("exits via request_app_exit after explicitly discarding on an app-exit intent", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-exit-discard",
          path: "/tmp/exit-discard.txt",
          displayName: "exit-discard.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "close_document" || cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-discard")?.click();
    });

    expect(
      invokeMock.mock.calls.some((call) => call[0] === "close_document"),
    ).toBe(true);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(true);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("completes an Untitled first save on an app-exit intent and exits", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      if (cmd === "pick_save_directory") {
        return { id: "grant-exit", displayName: "tmp" };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-exit-untitled",
          path: "/tmp/exit-untitled.txt",
          displayName: "exit-untitled.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "saved" },
          readOnly: false,
        };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit(false);
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });
    expect(container.querySelector(".save-as-dialog")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .save-as-location-button")
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document_as_at"),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(true);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("completes a read-only save-as on an app-exit intent and exits", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-exit-ro",
          path: "/tmp/exit-ro.txt",
          displayName: "exit-ro.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: true,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "exit-ro.txt",
          directory: { id: "grant-ro", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-exit-ro",
          path: "/tmp/exit-ro-new.txt",
          displayName: "exit-ro-new.txt",
          byteCount: 12,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 12, sha256: "saved" },
          readOnly: false,
        };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });
    expect(container.querySelector(".save-as-dialog")).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "save_document_as_at"),
    ).toHaveLength(1);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(true);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("does not exit when a close-time save fails on an app-exit intent", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-exit-fail",
          path: "/tmp/exit-fail.txt",
          displayName: "exit-fail.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw { code: "save-failed", message: "fail" };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
    expect(container.querySelector(".notice-error")).not.toBeNull();
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
  });

  it("does not exit when the format chooser is cancelled on an app-exit intent", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "prepare_save_as") {
        return { fileName: "Untitled", directory: null };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit(false);
    await emitAppExitRequest();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-cancel")
        ?.click();
    });

    expect(
      invokeMock.mock.calls.some((call) => call[0] === "save_document_as_at"),
    ).toBe(false);
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
    await emitAppExitRequest();
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).not.toBeNull();
  });

  it("clears the app-exit intent and does not exit on a close-time content conflict", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-exit-conflict",
          path: "/tmp/exit-conflict.txt",
          displayName: "exit-conflict.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw { code: "save-conflict-content-changed", message: "conflict" };
      }
      if (cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(container.querySelector(".notice-conflict")).not.toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });

  it("clears the app-exit intent and does not exit on a close-time missing target", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-exit-missing",
          path: "/tmp/exit-missing.txt",
          displayName: "exit-missing.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "old" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("Hello").buffer;
      }
      if (cmd === "save_document") {
        throw { code: "save-conflict-target-missing", message: "missing" };
      }
      if (cmd === "close_document" || cmd === "request_app_exit") {
        return undefined;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
    await renderAndEdit();
    await emitAppExitRequest();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(
      container.querySelector('[aria-label="File missing on disk"]'),
    ).not.toBeNull();
    expect(
      invokeMock.mock.calls.some((call) => call[0] === "request_app_exit"),
    ).toBe(false);
    expect(tauriWindowMock.close).not.toHaveBeenCalled();
  });
});

describe("App bottom-right format settings", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function setSelectValue(select: HTMLSelectElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("shows the default Untitled format (UTF-8 · LF) and stays collapsed", async () => {
    await act(async () => {
      root.render(<App />);
    });
    const summary = container.querySelector(".format-settings-summary");
    expect(summary).not.toBeNull();
    expect(summary?.textContent).toContain("UTF-8");
    expect(summary?.textContent).toContain("LF");
    expect(container.querySelector(".format-settings-popover")).toBeNull();
  });

  it("opens the popover with encoding and line-ending selectors, then cancels closed", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    const popover = container.querySelector(".format-settings-popover");
    expect(popover).not.toBeNull();
    expect(popover?.querySelectorAll("select").length).toBe(2);

    await act(async () => {
      popover?.querySelector<HTMLButtonElement>(".confirm-cancel")?.click();
    });
    expect(container.querySelector(".format-settings-popover")).toBeNull();
  });

  it("applies the chosen encoding and line ending on Done", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    const selects = container.querySelectorAll<HTMLSelectElement>(
      ".format-settings-popover select",
    );
    await act(async () => {
      setSelectValue(selects[0]!, "gbk");
      setSelectValue(selects[1]!, "crlf");
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".format-settings-popover .confirm-save")
        ?.click();
    });
    const summary = container.querySelector(".format-settings-summary");
    expect(summary?.textContent).toContain("GBK");
    expect(summary?.textContent).toContain("CRLF");
  });

  it("keeps saveFormat unchanged when Cancel is clicked after editing the draft", async () => {
    await act(async () => {
      root.render(<App />);
    });
    const before = container.querySelector(".format-settings-summary")?.textContent ?? "";
    expect(before).toContain("UTF-8");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    const selects = container.querySelectorAll<HTMLSelectElement>(
      ".format-settings-popover select",
    );
    await act(async () => {
      setSelectValue(selects[0]!, "gbk");
      setSelectValue(selects[1]!, "crlf");
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".format-settings-popover .confirm-cancel")
        ?.click();
    });
    const after = container.querySelector(".format-settings-summary")?.textContent ?? "";
    expect(after).toContain("UTF-8");
    expect(after).toContain("LF");
    expect(after).not.toContain("GBK");
  });

  it("warns about mixed line endings and marks the summary", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-mixed",
          path: "/tmp/mixed.txt",
          displayName: "mixed.txt",
          byteCount: 7,
          encoding: { utf8: { bom: false } },
          lineEnding: "mixed",
          fingerprint: { sizeBytes: 7, sha256: "mix" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("a\r\nb\nc").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    expect(
      container.querySelector(".format-settings-summary")?.textContent,
    ).toContain("Mixed");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    expect(container.querySelector(".format-settings-mixed")).not.toBeNull();
  });

  it("blocks mixed save-as until LF or CRLF is explicitly confirmed", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-mixed-save",
          path: "/tmp/mixed.txt",
          displayName: "mixed.txt",
          byteCount: 7,
          encoding: { utf8: { bom: false } },
          lineEnding: "mixed",
          fingerprint: { sizeBytes: 7, sha256: "mix" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("a\r\nb\nc").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "mixed.txt",
          directory: { id: "grant-mixed", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-mixed-save",
          path: "/tmp/mixed-normalized.txt",
          displayName: "mixed-normalized.txt",
          byteCount: 7,
          encoding: { utf8: { bom: false } },
          lineEnding: "crlf",
          fingerprint: { sizeBytes: 7, sha256: "saved" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });
    expect(container.querySelector(".save-as-validation")?.textContent).toContain(
      "mixed line endings",
    );
    expect(
      container.querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.disabled,
    ).toBe(true);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-cancel")
        ?.click();
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    const selects = container.querySelectorAll<HTMLSelectElement>(
      ".format-settings-popover select",
    );
    await act(async () => {
      setSelectValue(selects[1]!, "crlf");
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".format-settings-popover .confirm-save")
        ?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });
    expect(
      container.querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.disabled,
    ).toBe(false);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".save-as-dialog .confirm-save")
        ?.click();
    });

    const saveCall = invokeMock.mock.calls.find(
      (call) => call[0] === "save_document_as_at",
    );
    expect(saveCall?.[2]).toMatchObject({
      headers: { "textora-line-ending": "crlf" },
    });
  });

  it("discards the stale draft and closes the popover when the document changes mid-edit", async () => {
    // 文档 B 设为 UTF-8/LF，与即将编辑的旧草稿 GBK/CRLF 在两个字段上都区分开。
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-b",
          path: "/tmp/notes-b.txt",
          displayName: "notes-b.txt",
          byteCount: 5,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 5, sha256: "beef" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("World").buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));

    // 在 Untitled 上打开弹层并把草稿改成 GBK/CRLF，但不点 Done。
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    const draftSelects = container.querySelectorAll<HTMLSelectElement>(
      ".format-settings-popover select",
    );
    await act(async () => {
      setSelectValue(draftSelects[0]!, "gbk");
      setSelectValue(draftSelects[1]!, "crlf");
    });

    // 未提交草稿就切换到文档 B。
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });

    // 弹层关闭——旧草稿不再有可提交的入口，无法覆盖新文档格式。
    expect(container.querySelector(".format-settings-popover")).toBeNull();
    // saveFormat 反映文档 B（UTF-8/LF），旧草稿 GBK/CRLF 不残留。
    const summary = container.querySelector(".format-settings-summary");
    expect(summary?.textContent).toContain("UTF-8");
    expect(summary?.textContent).toContain("LF");
    expect(summary?.textContent).not.toContain("GBK");
    expect(summary?.textContent).not.toContain("CRLF");

    // 重新打开弹层，草稿应为文档 B 的格式（UTF-8/LF），而非旧草稿。
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-settings-summary")?.click();
    });
    const reopenedSelects = container.querySelectorAll<HTMLSelectElement>(
      ".format-settings-popover select",
    );
    expect(reopenedSelects[0]?.value).toBe("utf8");
    expect(reopenedSelects[1]?.value).toBe("lf");
  });
});

describe("App Format JSON", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function mockOpenMarkdown(content: string, readOnly = false) {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/test.md",
          displayName: "test.md",
          byteCount: content.length,
          encoding: "utf8",
          lineEnding: "lf",
          fingerprint: { sizeBytes: content.length, sha256: "md" },
          readOnly,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode(content).buffer;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
  }

  async function openMarkdown(content: string, readOnly = false) {
    mockOpenMarkdown(content, readOnly);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
  }

  it("shows Format JSON for a markdown document but not for plain text", async () => {
    await act(async () => root.render(<App />));
    expect(container.querySelector(".format-json-button")).toBeNull();

    await openMarkdown("# title\n");
    expect(container.querySelector(".format-json-button")).not.toBeNull();
  });

  it("auto-closes a markdown opening fence with an info string from the app editor", async () => {
    await act(async () => root.render(<App />));
    await openMarkdown("```json");

    const editable = container.querySelector<HTMLElement>(".cm-content");
    expect(editable).not.toBeNull();
    const view = editable === null ? null : EditorView.findFromDOM(editable);
    expect(view).not.toBeNull();
    await act(async () => {
      view?.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
      editable?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(view?.state.doc.toString()).toBe("```json\n\n```");
  });

  it("hides Format JSON while WYSIWYG is active", async () => {
    await act(async () => root.render(<App />));
    await openMarkdown("# title\n");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")?.click();
    });
    expect(container.querySelector(".format-json-button")).toBeNull();
    expect(container.querySelector('[aria-label="Markdown WYSIWYG editor"]')).not.toBeNull();
  });

  it("disables Format JSON for a read-only markdown document", async () => {
    await act(async () => root.render(<App />));
    await openMarkdown("# title\n", true);

    expect(
      container.querySelector<HTMLButtonElement>(".format-json-button")?.disabled,
    ).toBe(true);
  });

  it("shows a non-blocking notice and leaves the document unchanged when the cursor is not in a closed json fence", async () => {
    const content = "```json\n{}\n```";
    await act(async () => root.render(<App />));
    await openMarkdown(content);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-json-button")?.click();
    });

    const notice = container.querySelector(".notice-format-json");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("closed JSON fenced code block");
    // 光标默认在行首（opening fence 行），文档不变。
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain("```json");
    // 提示是非阻塞的：其它编辑入口仍可用。
    expect(
      container.querySelector<HTMLButtonElement>(".column-sequence-button")?.disabled,
    ).toBe(false);

    await act(async () => {
      notice?.querySelector<HTMLButtonElement>(".notice-dismiss")?.click();
    });
    expect(container.querySelector(".notice-format-json")).toBeNull();
  });

  it("clears the format-json notice when switching to another tab", async () => {
    await act(async () => root.render(<App />));
    await openMarkdown("```json\n{}\n```");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-json-button")?.click();
    });
    expect(container.querySelector(".notice-format-json")).not.toBeNull();

    // 切换到初始 Untitled 标签：光标与文档上下文变化，提示应被清除。
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(container.querySelector(".notice-format-json")).toBeNull();
  });

  it("clears the format-json notice when toggling WYSIWYG", async () => {
    await act(async () => root.render(<App />));
    await openMarkdown("```json\n{}\n```");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-json-button")?.click();
    });
    expect(container.querySelector(".notice-format-json")).not.toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".markdown-wysiwyg-toggle")?.click();
    });
    expect(container.querySelector(".notice-format-json")).toBeNull();
  });

  it("clears the format-json notice after saving the markdown document as plain text", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return {
          id: "doc-md",
          path: "/tmp/test.md",
          displayName: "test.md",
          byteCount: 14,
          encoding: "utf8",
          lineEnding: "lf",
          fingerprint: { sizeBytes: 14, sha256: "md" },
          readOnly: false,
        };
      }
      if (cmd === "read_document_content") {
        return new TextEncoder().encode("```json\n{}\n```").buffer;
      }
      if (cmd === "prepare_save_as") {
        return {
          fileName: "test.md",
          directory: { id: "grant", displayName: "tmp" },
        };
      }
      if (cmd === "preview_save_target") {
        return { exists: false, isCurrentPath: false };
      }
      if (cmd === "save_document_as_at") {
        return {
          id: "doc-md",
          path: "/tmp/notes.txt",
          displayName: "notes.txt",
          byteCount: 14,
          encoding: { utf8: { bom: false } },
          lineEnding: "lf",
          fingerprint: { sizeBytes: 14, sha256: "new" },
          readOnly: false,
        };
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => root.render(<App />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".format-json-button")?.click();
    });
    expect(container.querySelector(".notice-format-json")).not.toBeNull();

    // 另存为 notes.txt：活动文档身份（路径）改变，提示应被清除。
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".save-as-button")?.click();
    });
    const chooser = container.querySelector(".save-as-dialog");
    const fileName = chooser?.querySelector<HTMLInputElement>('input[type="text"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(fileName, "notes.txt");
      fileName?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      chooser?.querySelector<HTMLButtonElement>(".confirm-save")?.click();
    });

    expect(container.querySelector(".notice-format-json")).toBeNull();
    // 活动语言随 .txt 回到 plain-text，Format JSON 按钮消失。
    expect(container.querySelector(".format-json-button")).toBeNull();
  });
});

describe("App session restore", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    resetTauriWindowMock();
    setupInvoke();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function restoredDescriptor(
    id: string,
    path: string,
    displayName: string,
  ) {
    return {
      id,
      path,
      displayName,
      byteCount: 3,
      encoding: { utf8: { bom: false } },
      lineEnding: "lf" as const,
      fingerprint: { sizeBytes: 3, sha256: id },
      readOnly: false,
    };
  }

  function mockContentReads(
    contentById: Record<string, string | Error | Promise<string | Error>>,
  ) {
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "read_document_content") {
        const { id } = args as { id: string };
        const value = contentById[id];
        if (value === undefined) {
          throw new Error(`unexpected content read for ${id}`);
        }
        const content = await value;
        if (content instanceof Error) {
          throw content;
        }
        return new TextEncoder().encode(content).buffer;
      }
      if (cmd === "close_document") {
        return undefined;
      }
      if (cmd === "refresh_external_document") {
        return null;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });
  }

  it("adopts restored files in order with the manifest active tab and projects the session", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    mockContentReads({ "doc-a": "alpha", "doc-b": "beta" });

    await act(async () => {
      root.render(<App />);
    });

    const tabTitles = Array.from(
      container.querySelectorAll(".document-tab-select .document-tab-title"),
    ).map((node) => node.textContent);
    expect(tabTitles).toEqual(["a.md", "b.txt"]);
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("b.txt");
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "beta",
    );
    expect(container.querySelector(".notice-session")).toBeNull();
    // 初始 Untitled 被恢复的文件替换；投影含顺序与活动项。
    expect(sessionCommandsMock.manifestCalls).toEqual([
      {
        projection: {
          generation: 1,
          documentIds: ["doc-a", "doc-b"],
          activeDocumentId: "doc-b",
        },
      },
    ]);
    // 恢复完成后对每个已恢复文件执行一次可信复核。
    expect(
      invokeMock.mock.calls
        .filter((call) => call[0] === "refresh_external_document")
        .map((call) => (call[1] as { id: string }).id),
    ).toEqual(["doc-a", "doc-b"]);
  });

  it("skips failed files, cleans up failed content reads, and falls back to the last restored tab", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 3, activeIndex: 0 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "failed",
        displayName: "gone.md",
        error: { code: "read-failed", message: "io" },
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 2,
      },
      { kind: "done" },
    ];
    mockContentReads({
      "doc-a": new Error("content fetch failed"),
      "doc-b": "beta",
    });

    await act(async () => {
      root.render(<App />);
    });

    const tabTitles = Array.from(
      container.querySelectorAll(".document-tab-select .document-tab-title"),
    ).map((node) => node.textContent);
    expect(tabTitles).toEqual(["b.txt"]);
    // 建议活动项（清单索引 0）失败时，回落到最后成功恢复的文件。
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("b.txt");
    // 内容取回失败的条目被逐项清理，不阻塞其他文件。
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === "close_document"),
    ).toEqual([["close_document", { id: "doc-a" }]]);
    // 非模态汇总提示列出打开失败与取回失败的原因，可关闭。
    const notice = container.querySelector(".notice-session");
    expect(notice?.textContent).toContain("could not be restored");
    expect(notice?.textContent).toContain("gone.md");
    expect(notice?.textContent).toContain("a.md");
    await act(async () => {
      notice?.querySelector<HTMLButtonElement>(".notice-dismiss")?.click();
    });
    expect(container.querySelector(".notice-session")).toBeNull();
    // 下一份清单只含成功恢复的文件，失败路径被移除。
    expect(sessionCommandsMock.manifestCalls).toEqual([
      {
        projection: {
          generation: 1,
          documentIds: ["doc-b"],
          activeDocumentId: "doc-b",
        },
      },
    ]);
  });

  it("keeps the default Untitled startup when there is nothing to restore", async () => {
    sessionCommandsMock.restoreSteps = [{ kind: "done" }];

    await act(async () => {
      root.render(<App />);
    });

    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["Untitled"]);
    expect(container.querySelector(".notice-session")).toBeNull();
    expect(sessionCommandsMock.manifestCalls).toEqual([
      {
        projection: {
          generation: 1,
          documentIds: [],
          activeDocumentId: null,
        },
      },
    ]);
  });

  it("locks competing operations while the restore is running and unlocks after", async () => {
    let resolveStep: ((step: unknown) => void) | undefined;
    sessionCommandsMock.restoreSteps = [
      new Promise((resolve) => {
        resolveStep = resolve;
      }),
    ];

    await act(async () => {
      root.render(<App />);
    });

    expect(
      container.querySelector<HTMLButtonElement>(".open-button")?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.disabled,
    ).toBe(true);
    expect(
      container.querySelector(".notice-loading")?.textContent,
    ).toContain("Restoring previous session");

    await act(async () => {
      resolveStep?.({ kind: "done" });
    });

    expect(
      container.querySelector<HTMLButtonElement>(".open-button")?.disabled,
    ).toBe(false);
    expect(container.querySelector(".notice-loading")).toBeNull();
  });

  it("projects a new generation after switching the active tab", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    mockContentReads({ "doc-a": "alpha", "doc-b": "beta" });

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });

    expect(sessionCommandsMock.manifestCalls).toEqual([
      {
        projection: {
          generation: 1,
          documentIds: ["doc-a", "doc-b"],
          activeDocumentId: "doc-b",
        },
      },
      {
        projection: {
          generation: 2,
          documentIds: ["doc-a", "doc-b"],
          activeDocumentId: "doc-a",
        },
      },
    ]);
  });

  it("keeps an external change of the first file while the second content read is delayed", async () => {
    let resolveBeta: ((value: string | Error) => void) | undefined;
    const betaPending = new Promise<string | Error>((resolve) => {
      resolveBeta = resolve;
    });
    const contentById: Record<string, string | Error | Promise<string | Error>> = {
      "doc-a": "alpha",
      "doc-b": betaPending,
    };
    const externallyChanged = {
      ...restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
      fingerprint: { sizeBytes: 8, sha256: "a-external" },
    };
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "read_document_content") {
        const { id } = args as { id: string };
        const value = contentById[id];
        if (value === undefined) {
          throw new Error(`unexpected content read for ${id}`);
        }
        const content = await value;
        if (content instanceof Error) {
          throw content;
        }
        return new TextEncoder().encode(content).buffer;
      }
      if (cmd === "prepare_external_reload") {
        return { kind: "content", descriptor: externallyChanged };
      }
      if (cmd === "refresh_external_document") {
        return null;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => {
      root.render(<App />);
    });

    // 第一个文件已采用为标签；第二个文件的正文读取被延迟，恢复仍在进行。此刻第一个
    // 文件发生外部修改：事件不得因恢复未完成而被丢弃。
    await act(async () => {
      contentById["doc-a"] = "alpha-v2";
      await emitExternalChange({ documentId: "doc-a", kind: "content" });
      await vi.waitFor(() => {
        expect(
          invokeMock.mock.calls.filter(
            (call) =>
              call[0] === "read_document_content" &&
              (call[1] as { id: string }).id === "doc-a",
          ),
        ).toHaveLength(2);
      });
    });

    await act(async () => {
      resolveBeta?.("beta");
    });

    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["a.md", "b.txt"]);
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("b.txt");
    // 恢复完成后的可信复核覆盖每个已恢复文件。
    expect(
      invokeMock.mock.calls
        .filter((call) => call[0] === "refresh_external_document")
        .map((call) => (call[1] as { id: string }).id),
    ).toEqual(["doc-a", "doc-b"]);
    // 第一个文件的会话内容已更新为外部版本。
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "alpha-v2",
    );
  });

  it("keeps the launch manifest untouched when the first restore step rejects", async () => {
    sessionCommandsMock.restoreSteps = [new Error("restore transport failed")];

    await act(async () => {
      root.render(<App />);
    });

    // 中断不是完成：保持默认 Untitled，不把空会话写回清单。
    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["Untitled"]);
    expect(sessionCommandsMock.manifestCalls).toEqual([]);
    // 非模态错误提示，编辑入口解锁，并提供安全重试。
    const notice = container.querySelector(".notice-session");
    expect(notice?.textContent).toContain("could not be fully restored");
    expect(notice?.textContent).toContain("stay on the restore list");
    expect(
      container.querySelector<HTMLButtonElement>(".column-sequence-button")
        ?.disabled,
    ).toBe(false);
    expect(notice?.querySelector<HTMLButtonElement>(".notice-action")?.textContent).toBe(
      "Retry",
    );
  });

  it("keeps the launch manifest untouched when a later step rejects after adopting the first item", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: null },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      new Error("restore transport failed"),
    ];
    mockContentReads({ "doc-a": "alpha" });

    await act(async () => {
      root.render(<App />);
    });

    // 已采用的第一项保留并成为活动标签（回落最后成功项）。
    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["a.md"]);
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("a.md");
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "alpha",
    );
    // 中断不是完成：不得把部分会话写回清单，未处理文件留给下次启动。
    expect(container.querySelector(".notice-session")?.textContent).toContain(
      "could not be fully restored",
    );
    expect(sessionCommandsMock.manifestCalls).toEqual([]);
  });

  it("resumes safely after retrying an interrupted restore and then projects the full session", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      new Error("restore transport failed"),
    ];
    mockContentReads({ "doc-a": "alpha", "doc-b": "beta" });

    await act(async () => {
      root.render(<App />);
    });
    expect(sessionCommandsMock.manifestCalls).toEqual([]);

    // 重试继续同一后端游标：剩余条目处理完后才写完整投影。
    sessionCommandsMock.restoreSteps = [
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-session .notice-action")
        ?.click();
    });

    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["a.md", "b.txt"]);
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("b.txt");
    expect(container.querySelector(".notice-session")).toBeNull();
    expect(sessionCommandsMock.manifestCalls).toEqual([
      {
        projection: {
          generation: 1,
          documentIds: ["doc-a", "doc-b"],
          activeDocumentId: "doc-b",
        },
      },
    ]);
  });

  it("preserves an edited initial Untitled when a retried restore completes", async () => {
    sessionCommandsMock.restoreSteps = [new Error("restore transport failed")];
    mockContentReads({ "doc-a": "alpha", "doc-b": "beta" });

    await act(async () => {
      root.render(<App />);
    });
    expect(container.querySelector(".notice-session")).not.toBeNull();

    // 中断解锁后用户编辑了初始 Untitled（脏状态）。
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    await act(async () => {
      editable.textContent = "draft notes";
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "draft notes",
        }),
      );
      await Promise.resolve();
    });
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );

    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-session .notice-action")
        ?.click();
    });

    // 编辑过的占位标签保留，两个文件按序恢复，清单活动项成为活动标签。
    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["Untitled", "a.md", "b.txt"]);
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("b.txt");

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "draft notes",
    );
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
  });

  it("preserves a new Untitled tab created during an interrupted restore", async () => {
    sessionCommandsMock.restoreSteps = [new Error("restore transport failed")];
    mockContentReads({ "doc-a": "alpha" });

    await act(async () => {
      root.render(<App />);
    });

    // 中断解锁后用户新建并编辑了一个 Untitled 标签。
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".new-tab-button")?.click();
    });
    const editable = container.querySelector<HTMLElement>(".cm-content")!;
    await act(async () => {
      editable.textContent = "scratch";
      editable.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "scratch",
        }),
      );
      await Promise.resolve();
    });

    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 1, activeIndex: 0 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      { kind: "done" },
    ];
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-session .notice-action")
        ?.click();
    });

    // 用户新建的标签保留（含内容与脏状态）；未触碰的初始占位照常移除。
    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["Untitled 2", "a.md"]);
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "scratch",
    );
    expect(container.querySelector(".statusbar")?.textContent).toContain(
      "Modified",
    );
  });

  it("removes the untouched initial placeholder after a normal completed restore", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 1, activeIndex: 0 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      { kind: "done" },
    ];
    mockContentReads({ "doc-a": "alpha" });

    await act(async () => {
      root.render(<App />);
    });

    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["a.md"]);
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("a.md");
  });

  it("maps manifest entries the user opened during an interruption to the existing tab", async () => {
    // 首次推进即中断（清单 [a.md(0), b.txt(1)]，活动项指向 b）。
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      new Error("restore transport failed"),
    ];
    invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "health_check") {
        return { service: "document-core", version: "0.1.0" };
      }
      if (cmd === "select_and_open_document") {
        return restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt");
      }
      if (cmd === "read_document_content") {
        const { id } = args as { id: string };
        const content = id === "doc-b" ? "beta" : "alpha";
        return new TextEncoder().encode(content).buffer;
      }
      if (cmd === "refresh_external_document") {
        return null;
      }
      throw new Error(`unexpected invoke ${cmd}`);
    });

    await act(async () => {
      root.render(<App />);
    });
    // 中断解锁后用户经普通 Open 打开下一清单文件 b.txt。
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["Untitled", "b.txt"]);

    // Retry：剩余清单项 a 正常恢复，b 映射到现有标签而不重复。
    sessionCommandsMock.restoreSteps = [
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      { kind: "already-open", documentId: "doc-b", manifestIndex: 1 },
      { kind: "done" },
    ];
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-session .notice-action")
        ?.click();
    });

    const titles = Array.from(
      container.querySelectorAll(".document-tab-select .document-tab-title"),
    ).map((node) => node.textContent);
    expect(titles).toEqual(["b.txt", "a.md"]);
    expect(titles.filter((title) => title === "b.txt")).toHaveLength(1);
    // 清单声明的活动项指向用户已打开的文件：活动标签落到现有标签。
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("b.txt");
    expect(container.querySelector(".cm-content")?.textContent ?? "").toContain(
      "beta",
    );
    // 完整投影（现有标签在前）成功写出，不因重复路径被拒绝。
    expect(sessionCommandsMock.manifestCalls).toEqual([
      {
        projection: {
          generation: 1,
          documentIds: ["doc-b", "doc-a"],
          activeDocumentId: "doc-b",
        },
      },
    ]);
  });

  it("accumulates failure summaries across an interruption and retries until done", async () => {
    // 首次运行：一个单项失败后命令中断。
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 3, activeIndex: 1 },
      {
        kind: "failed",
        displayName: "gone.md",
        error: { code: "read-failed", message: "io" },
      },
      new Error("restore transport failed"),
    ];
    mockContentReads({ "doc-a": "alpha", "doc-b": "beta" });

    await act(async () => {
      root.render(<App />);
    });
    expect(container.querySelector(".notice-session")?.textContent).toContain(
      "gone.md",
    );

    // Retry：剩余两个文件成功并返回 done；最终提示仍包含先前失败文件，清单只含成功文件。
    sessionCommandsMock.restoreSteps = [
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 2,
      },
      { kind: "done" },
    ];
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".notice-session .notice-action")
        ?.click();
    });

    const notice = container.querySelector(".notice-session");
    expect(notice?.textContent).toContain("1 file(s) from the last session could not be restored");
    expect(notice?.textContent).toContain("gone.md");
    expect(
      Array.from(
        container.querySelectorAll(".document-tab-select .document-tab-title"),
      ).map((node) => node.textContent),
    ).toEqual(["a.md", "b.txt"]);
    expect(
      container.querySelector(".document-tab.is-active .document-tab-title")
        ?.textContent,
    ).toBe("b.txt");
    expect(sessionCommandsMock.manifestCalls).toEqual([
      {
        projection: {
          generation: 1,
          documentIds: ["doc-a", "doc-b"],
          activeDocumentId: "doc-b",
        },
      },
    ]);
  });

  it("shows the restore failure summary and the manifest write failure at the same time", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 0 },
      {
        kind: "failed",
        displayName: "gone.md",
        error: { code: "read-failed", message: "io" },
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    sessionCommandsMock.manifestStatus = new Error("disk full");
    mockContentReads({ "doc-a": "alpha" });

    await act(async () => {
      root.render(<App />);
    });

    const notices = container.querySelectorAll(".notice-session");
    expect(notices).toHaveLength(2);
    const restoreNotice = notices[0];
    const manifestNotice = notices[1];
    expect(restoreNotice?.textContent).toContain("could not be restored");
    expect(restoreNotice?.textContent).toContain("gone.md");
    expect(manifestNotice?.textContent).toContain("could not be saved");
    // 两个提示都保持非模态：编辑入口不受影响。
    expect(
      container.querySelector<HTMLButtonElement>(".column-sequence-button")
        ?.disabled,
    ).toBe(false);

    // 各自独立关闭。
    await act(async () => {
      restoreNotice?.querySelector<HTMLButtonElement>(".notice-dismiss")?.click();
    });
    expect(container.querySelectorAll(".notice-session")).toHaveLength(1);
    expect(
      container.querySelector(".notice-session")?.textContent,
    ).toContain("could not be saved");
    await act(async () => {
      manifestNotice?.querySelector<HTMLButtonElement>(".notice-dismiss")?.click();
    });
    expect(container.querySelector(".notice-session")).toBeNull();
  });

  it("keeps the manifest write notice for rejected projections until a newer write succeeds", async () => {
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    sessionCommandsMock.manifestStatus = new Error("disk full");
    mockContentReads({ "doc-a": "alpha", "doc-b": "beta" });

    await act(async () => {
      root.render(<App />);
    });
    expect(
      container.querySelector(".notice-session")?.textContent,
    ).toContain("could not be saved");
    expect(sessionCommandsMock.manifestCalls).toHaveLength(1);

    // 切换活动标签触发第二次投影；rejected 未写入，旧提示必须保留。
    sessionCommandsMock.manifestStatus = "rejected";
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });

    expect(
      container.querySelector(".notice-session")?.textContent,
    ).toContain("could not be saved");
    expect(sessionCommandsMock.manifestCalls).toHaveLength(2);
    expect(sessionCommandsMock.manifestCalls[1]).toEqual({
      projection: {
        generation: 2,
        documentIds: ["doc-a", "doc-b"],
        activeDocumentId: "doc-a",
      },
    });

    // 再切回另一标签触发第三次投影；只有 written 才确认恢复并清除提示。
    sessionCommandsMock.manifestStatus = "written";
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[1]?.click();
    });

    expect(container.querySelector(".notice-session")).toBeNull();
    expect(sessionCommandsMock.manifestCalls).toHaveLength(3);
    expect(sessionCommandsMock.manifestCalls[2]).toEqual({
      projection: {
        generation: 3,
        documentIds: ["doc-a", "doc-b"],
        activeDocumentId: "doc-b",
      },
    });
  });

  it("ignores a late failure of an older manifest write after a newer success", async () => {
    let rejectFirstWrite: ((reason?: unknown) => void) | undefined;
    const firstWrite = new Promise<never>((_resolve, reject) => {
      rejectFirstWrite = reject;
    });
    sessionCommandsMock.restoreSteps = [
      { kind: "started", total: 2, activeIndex: 1 },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
        manifestIndex: 0,
      },
      {
        kind: "item",
        descriptor: restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
        manifestIndex: 1,
      },
      { kind: "done" },
    ];
    sessionCommandsMock.manifestStatus = firstWrite;
    mockContentReads({ "doc-a": "alpha", "doc-b": "beta" });

    // 第一次写入悬而未决。
    await act(async () => {
      root.render(<App />);
    });
    expect(container.querySelector(".notice-session")).toBeNull();

    // 切换活动标签触发第二次写入并成功。
    sessionCommandsMock.manifestStatus = "written";
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>(".document-tab-select")[0]?.click();
    });
    expect(sessionCommandsMock.manifestCalls).toHaveLength(2);

    // 第一次写入现在才失败：迟到的旧请求不得覆盖较新成功状态。
    await act(async () => {
      rejectFirstWrite?.(new Error("late write failure"));
    });
    expect(container.querySelector(".notice-session")).toBeNull();
  });

  it("shows a dismissible non-modal notice when the manifest write fails", async () => {
    sessionCommandsMock.manifestStatus = new Error("disk full");

    await act(async () => {
      root.render(<App />);
    });

    const notice = container.querySelector(".notice-session");
    expect(notice?.textContent).toContain("could not be saved");
    // 非模态：编辑入口不受影响。
    expect(
      container.querySelector<HTMLButtonElement>(".column-sequence-button")
        ?.disabled,
    ).toBe(false);
    await act(async () => {
      notice?.querySelector<HTMLButtonElement>(".notice-dismiss")?.click();
    });
    expect(container.querySelector(".notice-session")).toBeNull();
  });
});
