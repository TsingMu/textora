import { describe, expect, it } from "vitest";
import {
  describeOpenError,
  describeSaveError,
  encodingDisplayName,
  isDocumentCommandError,
  lineEndingDisplayName,
} from "./platform";

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
    expect(isDocumentCommandError({ code: "unknown", message: "x" })).toBe(false);
    expect(isDocumentCommandError({ code: "save-failed" })).toBe(false);
    expect(isDocumentCommandError(null)).toBe(false);
    expect(isDocumentCommandError("nope")).toBe(false);
  });
});
