import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  describeConflictReloadError,
  describeOpenError,
  describeSaveError,
  encodingDisplayName,
  encodingToChoice,
  isDocumentCommandError,
  lineEndingDisplayName,
  lineEndingToChoice,
  pickSaveDirectory,
  prepareExternalConflict,
  prepareExternalReload,
  prepareSaveAs,
  previewSaveTarget,
  refreshExternalDocument,
  restoreNextSessionDocument,
  retryExternalReload,
  saveAsAt,
  updateOpenFilesManifest,
} from "./platform";

beforeEach(() => {
  invokeMock.mockReset();
});

describe("encodingDisplayName", () => {
  it("labels UTF-8 without and with BOM", () => {
    expect(encodingDisplayName({ utf8: { bom: false } })).toBe("UTF-8");
    expect(encodingDisplayName({ utf8: { bom: true } })).toBe("UTF-8 (BOM)");
  });

  it("labels GBK", () => {
    expect(encodingDisplayName("gbk")).toBe("GBK");
  });
});

describe("lineEndingDisplayName", () => {
  it("maps each backend value", () => {
    expect(lineEndingDisplayName("lf")).toBe("LF");
    expect(lineEndingDisplayName("crlf")).toBe("CRLF");
    expect(lineEndingDisplayName("mixed")).toBe("Mixed");
  });
});

describe("document error descriptions", () => {
  it("does not mention internal details", () => {
    expect(describeOpenError("read-failed")).not.toContain("Rust");
  });

  it("uses save-specific wording for size and I/O failures", () => {
    expect(
      describeSaveError({ code: "file-too-large", message: "too large" }),
    ).toContain("cannot be saved");
    expect(
      describeSaveError({ code: "save-failed", message: "internal detail" }),
    ).toBe("The file could not be saved.");
  });

  it("does not advertise conflict actions before their UI is available", () => {
    const changed = describeSaveError({
      code: "save-conflict-content-changed",
      message: "changed",
    });
    const missing = describeSaveError({
      code: "save-conflict-target-missing",
      message: "missing",
    });

    expect(changed).toContain("Saving was refused");
    expect(changed).not.toMatch(/reload|overwrite|cancel/i);
    expect(missing).toContain("Saving was refused");
    expect(missing).not.toMatch(/keep|discard/i);
  });

  it("preserves stable reload failure reasons", () => {
    expect(
      describeConflictReloadError({
        code: "file-too-large",
        message: "too large",
      }),
    ).toContain("larger than 50 MB");
    expect(
      describeConflictReloadError({
        code: "changed-during-read",
        message: "changed",
      }),
    ).toContain("changed while being read");
    expect(
      describeConflictReloadError({
        code: "unknown-document",
        message: "stale",
      }),
    ).toContain("no longer active");
  });

  it("shows the unencodable character and UTF-8 byte offset", () => {
    const message = describeSaveError({
      code: "unencodable-content",
      message: "cannot encode",
      character: "😀",
      byteOffset: 12,
    });
    expect(message).toContain("U+1F600");
    expect(message).toContain("byte offset 12");
  });
});

describe("isDocumentCommandError", () => {
  it("accepts known open and save codes and rejects anything else", () => {
    expect(isDocumentCommandError({ code: "file-too-large", message: "x" })).toBe(true);
    expect(isDocumentCommandError({ code: "save-conflict", message: "x" })).toBe(true);
    expect(
      isDocumentCommandError({ code: "save-conflict-content-changed", message: "x" }),
    ).toBe(true);
    expect(
      isDocumentCommandError({ code: "save-conflict-target-missing", message: "x" }),
    ).toBe(true);
    expect(isDocumentCommandError({ code: "invalid-file-name", message: "x" })).toBe(
      true,
    );
    expect(isDocumentCommandError({ code: "missing-grant", message: "x" })).toBe(
      true,
    );
    expect(isDocumentCommandError({ code: "grant-mismatch", message: "x" })).toBe(
      true,
    );
    expect(isDocumentCommandError({ code: "unknown", message: "x" })).toBe(false);
    expect(isDocumentCommandError({ code: "save-failed" })).toBe(false);
    expect(isDocumentCommandError(null)).toBe(false);
    expect(isDocumentCommandError("nope")).toBe(false);
  });
});

describe("inline save-as IPC", () => {
  it("uses only document identity and grant metadata for target preparation", async () => {
    invokeMock
      .mockResolvedValueOnce({
        fileName: "notes.txt",
        directory: { id: "grant-1", displayName: "tmp" },
      })
      .mockResolvedValueOnce({ id: "grant-2", displayName: "Desktop" })
      .mockResolvedValueOnce({ exists: true, isCurrentPath: false });

    await prepareSaveAs("doc-1");
    await pickSaveDirectory("doc-1");
    await previewSaveTarget({
      id: "doc-1",
      directoryId: "grant-2",
      fileName: "copy.txt",
      currentTabId: "tab-1",
      knownDocuments: [{ tabId: "tab-1", path: "/tmp/notes.txt" }],
    });

    expect(invokeMock.mock.calls[0]).toEqual([
      "prepare_save_as",
      { documentId: "doc-1" },
    ]);
    expect(invokeMock.mock.calls[1]).toEqual([
      "pick_save_directory",
      { documentId: "doc-1" },
    ]);
    expect(invokeMock.mock.calls[2]).toEqual([
      "preview_save_target",
      {
        documentId: "doc-1",
        directoryId: "grant-2",
        fileName: "copy.txt",
        currentTabId: "tab-1",
        knownDocuments: [{ tabId: "tab-1", path: "/tmp/notes.txt" }],
      },
    ]);
  });

  it("percent-encodes a Unicode file name while keeping content binary", async () => {
    invokeMock.mockResolvedValue({ id: "doc-1" });
    await saveAsAt({
      id: "doc-1",
      directoryId: "grant-1",
      fileName: "报告 100%.txt",
      encoding: "utf8-bom",
      lineEnding: "crlf",
      content: "内容",
    });

    const [command, body, options] = invokeMock.mock.calls[0]!;
    expect(command).toBe("save_document_as_at");
    expect(Array.from(body as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode("内容")),
    );
    expect(options).toEqual({
      headers: {
        "textora-directory-id": "grant-1",
        "textora-file-name": "%E6%8A%A5%E5%91%8A%20100%25.txt",
        "textora-encoding": "utf8-bom",
        "textora-line-ending": "crlf",
        "textora-document-id": "doc-1",
      },
    });
  });
});

describe("external reload IPC", () => {
  it("adopts a candidate by document identity only", async () => {
    invokeMock.mockResolvedValue(null);
    await prepareExternalReload("doc-1");
    expect(invokeMock).toHaveBeenCalledWith("prepare_external_reload", { id: "doc-1" });
  });

  it("retries an external reload by document identity only", async () => {
    invokeMock.mockResolvedValue({ kind: "unchanged" });
    await retryExternalReload("doc-1");
    expect(invokeMock).toHaveBeenCalledWith("retry_external_reload", { id: "doc-1" });
  });

  it("refreshes an external document by document identity only", async () => {
    invokeMock.mockResolvedValue(null);
    await refreshExternalDocument("doc-1");
    expect(invokeMock).toHaveBeenCalledWith("refresh_external_document", {
      id: "doc-1",
    });
  });

  it("sends a dirty conflict snapshot as raw UTF-8 with only the document id", async () => {
    invokeMock.mockResolvedValue(true);
    await prepareExternalConflict("doc-1", "本地修改");
    const [command, body, options] = invokeMock.mock.calls[0]!;
    expect(command).toBe("prepare_external_conflict");
    expect(Array.from(body as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode("本地修改")),
    );
    expect(options).toEqual({
      headers: { "textora-document-id": "doc-1" },
    });
  });
});

describe("session restore IPC", () => {
  it("restores step by step by trusting only the backend-owned manifest", async () => {
    invokeMock.mockResolvedValue({ kind: "done" });
    await expect(restoreNextSessionDocument()).resolves.toEqual({ kind: "done" });
    expect(invokeMock).toHaveBeenCalledWith("restore_next_session_document");
  });

  it("submits projections with trusted document ids and a monotonic generation", async () => {
    invokeMock.mockResolvedValue("stale");
    await expect(
      updateOpenFilesManifest({
        generation: 4,
        documentIds: ["doc-1", "doc-2"],
        activeDocumentId: "doc-2",
      }),
    ).resolves.toBe("stale");
    expect(invokeMock).toHaveBeenCalledWith("update_open_files_manifest", {
      projection: {
        generation: 4,
        documentIds: ["doc-1", "doc-2"],
        activeDocumentId: "doc-2",
      },
    });
  });
});

describe("save format choice defaults", () => {
  it("maps current encoding to a chooser default", () => {
    expect(encodingToChoice({ utf8: { bom: false } })).toBe("utf8");
    expect(encodingToChoice({ utf8: { bom: true } })).toBe("utf8-bom");
    expect(encodingToChoice("gbk")).toBe("gbk");
  });

  it("maps current line ending to a chooser default, collapsing mixed to lf", () => {
    expect(lineEndingToChoice("lf")).toBe("lf");
    expect(lineEndingToChoice("crlf")).toBe("crlf");
    expect(lineEndingToChoice("mixed")).toBe("lf");
  });
});
