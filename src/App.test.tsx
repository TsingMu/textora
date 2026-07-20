// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
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
    throw new Error(`unexpected invoke ${cmd}`);
  });
}

describe("App open flow", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
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
    ).toEqual(["select_and_open_document"]);

    const tabText = container.querySelector(".document-tab")?.textContent ?? "";
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

    expect(container.querySelector(".document-tab")?.textContent).toContain("Untitled");
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
    expect(container.querySelector(".document-tab")?.textContent).toContain("Untitled");
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
    expect(container.querySelector(".document-tab")?.textContent).toContain("Untitled");
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

    await act(async () => {
      resolveSelection?.(null);
    });
    expect(
      container.querySelector<HTMLElement>(".cm-content")?.getAttribute("contenteditable"),
    ).toBe("true");
  });
});
