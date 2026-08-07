import { describe, expect, it } from "vitest";
import { updateDocumentContent } from "./documentSession";
import {
  activeDocument,
  addUntitledTab,
  closeTabCleanly,
  createInitialTabSession,
  switchActiveTab,
  updateActiveDocument,
} from "./tabSession";

describe("tab session", () => {
  it("starts with one Untitled tab and creates numbered Untitled tabs", () => {
    let state = createInitialTabSession();

    expect(state.tabs).toHaveLength(1);
    expect(activeDocument(state).displayName).toBe("Untitled");

    state = addUntitledTab(state);
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.map((tab) => tab.document.displayName)).toEqual([
      "Untitled",
      "Untitled 2",
    ]);
    expect(activeDocument(state).displayName).toBe("Untitled 2");

    state = addUntitledTab(state);
    expect(state.tabs.map((tab) => tab.document.displayName)).toEqual([
      "Untitled",
      "Untitled 2",
      "Untitled 3",
    ]);
    expect(activeDocument(state).displayName).toBe("Untitled 3");
  });

  it("switches active tabs without sharing content or dirty state", () => {
    let state = createInitialTabSession();
    const firstTabId = state.activeTabId;
    state = addUntitledTab(state);
    const secondTabId = state.activeTabId;

    state = updateActiveDocument(state, (document) =>
      updateDocumentContent(document, "second"),
    );
    state = switchActiveTab(state, firstTabId);
    expect(activeDocument(state).content).toBe("");
    expect(activeDocument(state).isDirty).toBe(false);

    state = updateActiveDocument(state, (document) =>
      updateDocumentContent(document, "first"),
    );
    expect(activeDocument(state).content).toBe("first");
    state = switchActiveTab(state, secondTabId);
    expect(activeDocument(state).content).toBe("second");
    expect(activeDocument(state).isDirty).toBe(true);
  });

  it("closes tabs and creates a fresh Untitled when the last tab closes", () => {
    let state = createInitialTabSession();
    const firstTabId = state.activeTabId;
    state = addUntitledTab(state);
    const secondTabId = state.activeTabId;

    state = closeTabCleanly(state, secondTabId);
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(firstTabId);

    state = closeTabCleanly(state, firstTabId);
    expect(state.tabs).toHaveLength(1);
    expect(activeDocument(state).displayName).toBe("Untitled 3");
    expect(activeDocument(state).content).toBe("");
    expect(activeDocument(state).isDirty).toBe(false);
  });
});
