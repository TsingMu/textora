// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLocalStorageStub, removeLocalStorageStub } from "./test/localStorageStub";
import {
  persistWordWrapPreference,
  readStoredWordWrapPreference,
} from "./wordWrapPreference";

describe("word wrap preference storage", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = installLocalStorageStub();
  });

  afterEach(() => {
    removeLocalStorageStub();
    vi.restoreAllMocks();
  });

  it("defaults to enabled when the key is missing, true, or invalid", () => {
    expect(readStoredWordWrapPreference()).toBe(true);
    storage.setItem("textora.wordWrapEnabled", "true");
    expect(readStoredWordWrapPreference()).toBe(true);
    storage.setItem("textora.wordWrapEnabled", "yes");
    expect(readStoredWordWrapPreference()).toBe(true);
  });

  it("reads a stored disabled preference", () => {
    storage.setItem("textora.wordWrapEnabled", "false");
    expect(readStoredWordWrapPreference()).toBe(false);
  });

  it("falls back to enabled when storage access throws", () => {
    storage.getItem = () => {
      throw new Error("storage unavailable");
    };
    expect(readStoredWordWrapPreference()).toBe(true);
  });

  it("persists only the canonical strings", () => {
    persistWordWrapPreference(false);
    expect(storage.getItem("textora.wordWrapEnabled")).toBe("false");
    persistWordWrapPreference(true);
    expect(storage.getItem("textora.wordWrapEnabled")).toBe("true");
  });

  it("swallows persistence failures without throwing", () => {
    storage.setItem = () => {
      throw new Error("storage unavailable");
    };
    expect(() => persistWordWrapPreference(false)).not.toThrow();
  });
});

