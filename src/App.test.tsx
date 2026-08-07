// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
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
  allowedCloseCount: 0,
  deferCloseEvent: false,
  pendingProgrammaticClose: undefined as
    | (() => Promise<void>)
    | undefined,
  unlisten: vi.fn(),
}));

const tauriEventMock = vi.hoisted(() => ({
  exitRequestedHandler: undefined as (() => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
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
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    _event: string,
    handler: (event: { payload: unknown }) => void,
  ) => {
    tauriEventMock.exitRequestedHandler = () => handler({ payload: null });
    return tauriEventMock.unlisten;
  },
}));
import App from "./App";

function setupInvoke() {
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

function resetTauriWindowMock() {
  tauriWindowMock.focusHandler = undefined;
  tauriWindowMock.closeHandler = undefined;
  tauriWindowMock.close.mockReset();
  tauriWindowMock.allowedCloseCount = 0;
  tauriWindowMock.deferCloseEvent = false;
  tauriWindowMock.pendingProgrammaticClose = undefined;
  tauriWindowMock.unlisten.mockReset();
  tauriEventMock.exitRequestedHandler = undefined;
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
      if (cmd === "check_target_exists") {
        return Promise.reject(
          new Error("existence check must not run in this state"),
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
      invokeMock.mock.calls.filter((call) => call[0] === "check_target_exists"),
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

  it("deduplicates focus checks and ignores a missing result for an old document", async () => {
    let selectionCount = 0;
    let resolveExistence: ((exists: boolean) => void) | undefined;
    invokeMock.mockImplementation(
      (cmd: string, args?: { id?: string }) => {
        if (cmd === "health_check") {
          return Promise.resolve({ service: "document-core", version: "0.1.0" });
        }
        if (cmd === "select_and_open_document") {
          selectionCount += 1;
          const suffix = selectionCount === 1 ? "a" : "b";
          return Promise.resolve({
            id: `doc-${suffix}`,
            path: `/tmp/${suffix}.txt`,
            displayName: `${suffix}.txt`,
            byteCount: 1,
            encoding: { utf8: { bom: false } },
            lineEnding: "lf",
            fingerprint: { sizeBytes: 1, sha256: suffix },
            readOnly: false,
          });
        }
        if (cmd === "read_document_content") {
          return Promise.resolve(
            new TextEncoder().encode(args?.id === "doc-a" ? "A" : "B").buffer,
          );
        }
        if (cmd === "check_target_exists") {
          return new Promise<boolean>((resolve) => {
            resolveExistence = resolve;
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
      invokeMock.mock.calls.filter((call) => call[0] === "check_target_exists"),
    ).toHaveLength(1);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".open-button")?.click();
    });
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "b.txt",
    );

    await act(async () => {
      resolveExistence?.(false);
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-label="File missing on disk"]')).toBeNull();
    expect(container.querySelector(".document-tab.is-active")?.textContent).toContain(
      "b.txt",
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

  it("allows a clean document to close without a confirmation", async () => {
    await act(async () => root.render(<App />));

    const preventDefault = await emitWindowClose();

    expect(preventDefault).not.toHaveBeenCalled();
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

  it("authorizes exactly one close after explicitly discarding", async () => {
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
    expect(tauriWindowMock.close).toHaveBeenCalledOnce();
    expect(tauriWindowMock.allowedCloseCount).toBe(1);
    expect(
      container.querySelector('[aria-label="Save before closing?"]'),
    ).toBeNull();
  });

  it("saves an opened document and consumes one close authorization", async () => {
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
    expect(tauriWindowMock.close).toHaveBeenCalledOnce();
    expect(tauriWindowMock.allowedCloseCount).toBe(1);
  });

  it("rejects a delayed close authorization after the document changes", async () => {
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
    expect(tauriWindowMock.pendingProgrammaticClose).toBeTypeOf("function");

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
    expect(tauriWindowMock.close).toHaveBeenCalledOnce();
    expect(tauriWindowMock.allowedCloseCount).toBe(1);
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
