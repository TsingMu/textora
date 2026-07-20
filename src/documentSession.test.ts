import { describe, expect, it } from "vitest";
import type { DocumentDescriptor } from "./platform";
import {
  cancelOpen,
  commitOpenedDocument,
  createNewDocument,
  failOpen,
  requestOpen,
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
