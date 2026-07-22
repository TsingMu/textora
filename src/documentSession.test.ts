import { describe, expect, it } from "vitest";
import type { DocumentCommandError, DocumentDescriptor } from "./platform";
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
} from "./documentSession";

const sampleDescriptor: DocumentDescriptor = {
  id: "doc-9",
  path: "/tmp/sample.txt",
  displayName: "sample.txt",
  byteCount: 6,
  encoding: { utf8: { bom: true } },
  lineEnding: "crlf",
  fingerprint: { sizeBytes: 6, sha256: "abc" },
  readOnly: true,
};

const readOnlyDescriptor: DocumentDescriptor = { ...sampleDescriptor, readOnly: true };
const saveConflictError: DocumentCommandError = {
  code: "save-conflict",
  message: "file changed",
};

function openedDirty(): ReturnType<typeof createNewDocument> {
  const writable: DocumentDescriptor = { ...sampleDescriptor, readOnly: false };
  const opened = commitOpenedDocument(createNewDocument(), writable, "initial");
  return updateDocumentContent(opened, "edited");
}

describe("document session", () => {
  it("creates a clean untitled UTF-8 LF document", () => {
    expect(createNewDocument("untitled-1")).toEqual({
      id: "untitled-1",
      path: null,
      displayName: "Untitled",
      content: "",
      encoding: { utf8: { bom: false } },
      lineEnding: "lf",
      readOnly: false,
      isDirty: false,
      openStatus: "idle",
      openErrorCode: null,
      saveStatus: "idle",
      saveError: null,
    });
  });

  it("marks the document dirty only after content changes", () => {
    const document = createNewDocument();

    expect(updateDocumentContent(document, "")).toBe(document);
    expect(updateDocumentContent(document, "Hello")).toMatchObject({
      content: "Hello",
      isDirty: true,
    });
  });
});

describe("open flow state machine", () => {
  it("requests loading immediately when the document is clean", () => {
    const next = requestOpen(createNewDocument());
    expect(next.openStatus).toBe("loading");
    expect(next.openErrorCode).toBeNull();
  });

  it("asks to discard before opening when the document is dirty", () => {
    const dirty = updateDocumentContent(createNewDocument(), "unsaved");
    const next = requestOpen(dirty);
    expect(next.openStatus).toBe("awaiting-discard-confirm");
  });

  it("does not start a second open flow while one is already active", () => {
    const loading = startLoading(createNewDocument());
    expect(requestOpen(loading)).toBe(loading);

    const awaiting = { ...createNewDocument(), openStatus: "awaiting-discard-confirm" } as const;
    expect(requestOpen(awaiting)).toBe(awaiting);
  });

  it("allows retrying after an error", () => {
    const errored = failOpen(createNewDocument(), "unsupported-encoding");
    expect(errored.openStatus).toBe("error");
    expect(errored.openErrorCode).toBe("unsupported-encoding");
    expect(requestOpen(errored).openStatus).toBe("loading");
  });

  it("cancelOpen returns to idle without touching content", () => {
    const dirty = updateDocumentContent(createNewDocument(), "keep me");
    const cancelled = cancelOpen(dirty);
    expect(cancelled.openStatus).toBe("idle");
    expect(cancelled.content).toBe("keep me");
    expect(cancelled.isDirty).toBe(true);
  });

  it("commitOpenedDocument atomically replaces content and clears dirty state", () => {
    const dirty = updateDocumentContent(createNewDocument(), "old unsaved");
    const committed = commitOpenedDocument(dirty, sampleDescriptor, "new\n");

    expect(committed).toMatchObject({
      id: "doc-9",
      path: "/tmp/sample.txt",
      displayName: "sample.txt",
      content: "new\n",
      encoding: { utf8: { bom: true } },
      lineEnding: "crlf",
      readOnly: true,
      isDirty: false,
      openStatus: "idle",
      openErrorCode: null,
    });
  });

  it("commitOpenedDocument discards stale error state", () => {
    const errored = failOpen(createNewDocument(), "file-too-large");
    const committed = commitOpenedDocument(errored, sampleDescriptor, "recovered");
    expect(committed.openStatus).toBe("idle");
    expect(committed.openErrorCode).toBeNull();
  });
});

describe("save flow state machine", () => {
  it("requests saving only for a dirty, opened, writable, idle document", () => {
    const fresh = createNewDocument();
    expect(requestSave(fresh)).toBe(fresh); // no path

    const readOnlyOpened = updateDocumentContent(
      commitOpenedDocument(createNewDocument(), readOnlyDescriptor, "x"),
      "edited",
    );
    expect(requestSave(readOnlyOpened)).toBe(readOnlyOpened); // read-only

    const opened = commitOpenedDocument(createNewDocument(), sampleDescriptor, "x");
    const writableOpened = { ...opened, readOnly: false };
    expect(requestSave(writableOpened)).toBe(writableOpened); // not dirty

    const next = requestSave(openedDirty());
    expect(next.saveStatus).toBe("saving");
    expect(next.saveError).toBeNull();
  });

  it("does not start a save while open or another save is active", () => {
    const saving = { ...openedDirty(), saveStatus: "saving" } as const;
    expect(requestSave(saving)).toBe(saving);

    const opening = { ...openedDirty(), openStatus: "loading" } as const;
    expect(requestSave(opening)).toBe(opening);
  });

  it("commitSavedDocument clears dirty and save state without changing content", () => {
    const dirty = openedDirty();
    const committed = commitSavedDocument(dirty, { ...sampleDescriptor, readOnly: false });
    expect(committed.isDirty).toBe(false);
    expect(committed.saveStatus).toBe("idle");
    expect(committed.saveError).toBeNull();
    expect(committed.content).toBe("edited");
  });

  it("failSave records the error and keeps content and dirty state", () => {
    const failed = failSave(openedDirty(), saveConflictError);
    expect(failed.saveStatus).toBe("error");
    expect(failed.saveError).toEqual(saveConflictError);
    expect(failed.isDirty).toBe(true);
    expect(failed.content).toBe("edited");
  });

  it("cancelSave returns to idle while preserving content", () => {
    const failed = failSave(openedDirty(), saveConflictError);
    const cancelled = cancelSave(failed);
    expect(cancelled.saveStatus).toBe("idle");
    expect(cancelled.saveError).toBeNull();
    expect(cancelled.isDirty).toBe(true);
  });

  it("isBusy is true during open loading, awaiting confirm, and saving", () => {
    expect(isBusy(createNewDocument())).toBe(false);
    expect(isBusy(startLoading(createNewDocument()))).toBe(true);
    expect(isBusy({ ...openedDirty(), saveStatus: "saving" })).toBe(true);
    expect(isBusy({ ...openedDirty(), openStatus: "awaiting-discard-confirm" })).toBe(true);
    expect(
      isBusy(
        failSave(openedDirty(), {
          code: "read-only",
          message: "read only",
        }),
      ),
    ).toBe(false);
  });

  it("commitSavedAs associates the session with a new target and clears dirty state", () => {
    const dirty = openedDirty();
    const savedAsDescriptor: DocumentDescriptor = {
      id: "doc-new",
      path: "/tmp/saved-as.txt",
      displayName: "saved-as.txt",
      byteCount: 6,
      encoding: { utf8: { bom: true } },
      lineEnding: "crlf",
      fingerprint: { sizeBytes: 6, sha256: "ff" },
      readOnly: false,
    };
    const committed = commitSavedAs(dirty, savedAsDescriptor);

    expect(committed).toMatchObject({
      id: "doc-new",
      path: "/tmp/saved-as.txt",
      displayName: "saved-as.txt",
      encoding: { utf8: { bom: true } },
      lineEnding: "crlf",
      readOnly: false,
      isDirty: false,
      saveStatus: "idle",
      saveError: null,
    });
    // 内容保持为用户当前所见。
    expect(committed.content).toBe("edited");
  });

  it("failSave preserves content and dirty marker with the full error envelope", () => {
    const error: DocumentCommandError = {
      code: "unencodable-content",
      message: "cannot encode",
      character: "😀",
      byteOffset: 7,
    };
    const failed = failSave(openedDirty(), error);
    expect(failed.saveStatus).toBe("error");
    expect(failed.saveError).toEqual(error);
    expect(failed.isDirty).toBe(true);
    expect(failed.content).toBe("edited");
  });
});
