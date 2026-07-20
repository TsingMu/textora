import { describe, expect, it } from "vitest";
import {
  describeOpenError,
  encodingDisplayName,
  isOpenError,
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

describe("describeOpenError", () => {
  it("returns a user-facing message for every code", () => {
    for (const code of [
      "file-too-large",
      "unsupported-encoding",
      "changed-during-read",
      "read-failed",
    ] as const) {
      expect(describeOpenError(code).length).toBeGreaterThan(0);
    }
  });

  it("does not mention internal details", () => {
    expect(describeOpenError("read-failed")).not.toContain("Rust");
  });
});

describe("isOpenError", () => {
  it("accepts a known code and rejects anything else", () => {
    expect(isOpenError({ code: "file-too-large", message: "x" })).toBe(true);
    expect(isOpenError({ code: "unknown", message: "x" })).toBe(false);
    expect(isOpenError(null)).toBe(false);
    expect(isOpenError("nope")).toBe(false);
  });
});
