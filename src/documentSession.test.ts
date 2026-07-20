import { describe, expect, it } from "vitest";
import { createNewDocument, updateDocumentContent } from "./documentSession";

describe("document session", () => {
  it("creates a clean UTF-8 LF document", () => {
    expect(createNewDocument("doc-1")).toEqual({
      id: "doc-1",
      displayName: "Untitled",
      content: "",
      encoding: "UTF-8",
      lineEnding: "LF",
      isDirty: false,
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
