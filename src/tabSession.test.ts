import { describe, expect, it } from "vitest";
import { updateDocumentContent } from "./documentSession";
import {
  activeDocument,
  addUntitledTab,
  appendRestoredTab,
  closeTabCleanly,
  createInitialTabSession,
  finalizeRestoredTabs,
  setMarkdownPreviewOpen,
  setMarkdownWysiwygOpen,
  setMermaidPreviewOpen,
  switchActiveTab,
  updateActiveDocument,
} from "./tabSession";
import type { DocumentDescriptor } from "./platform";

function restoredDescriptor(
  id: string,
  path: string,
  displayName: string,
): DocumentDescriptor {
  return {
    id,
    path,
    displayName,
    byteCount: 3,
    encoding: { utf8: { bom: false } },
    lineEnding: "lf",
    fingerprint: { sizeBytes: 3, sha256: id },
    readOnly: false,
  };
}

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

  it("keeps Markdown and Mermaid preview switches independent per tab", () => {
    let state = createInitialTabSession();
    const firstTabId = state.activeTabId;
    state = addUntitledTab(state);
    const secondTabId = state.activeTabId;

    state = setMarkdownPreviewOpen(state, firstTabId, true);
    state = setMermaidPreviewOpen(state, secondTabId, true);

    expect(
      state.tabs.find((tab) => tab.tabId === firstTabId)?.markdownPreviewOpen,
    ).toBe(true);
    expect(
      state.tabs.find((tab) => tab.tabId === firstTabId)?.mermaidPreviewOpen,
    ).toBe(false);
    expect(
      state.tabs.find((tab) => tab.tabId === secondTabId)?.markdownPreviewOpen,
    ).toBe(false);
    expect(
      state.tabs.find((tab) => tab.tabId === secondTabId)?.mermaidPreviewOpen,
    ).toBe(true);
  });

  it("keeps Markdown Preview and WYSIWYG modes mutually exclusive per tab", () => {
    let state = createInitialTabSession();
    const firstTabId = state.activeTabId;
    state = addUntitledTab(state);
    const secondTabId = state.activeTabId;

    state = setMarkdownPreviewOpen(state, firstTabId, true);
    state = setMarkdownWysiwygOpen(state, firstTabId, true);
    state = setMarkdownPreviewOpen(state, secondTabId, true);

    const first = state.tabs.find((tab) => tab.tabId === firstTabId);
    const second = state.tabs.find((tab) => tab.tabId === secondTabId);

    expect(first?.markdownPreviewOpen).toBe(false);
    expect(first?.markdownWysiwygOpen).toBe(true);
    expect(second?.markdownPreviewOpen).toBe(true);
    expect(second?.markdownWysiwygOpen).toBe(false);
  });

  it("adopts restored files incrementally and finalizes with the suggested active tab", () => {
    let state = createInitialTabSession();
    state = appendRestoredTab(
      state,
      restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
      "alpha",
    );
    // 恢复期间不激活新标签，初始 Untitled 保持活动；内容为干净会话。
    expect(state.activeTabId).toBe("tab-1");
    expect(state.tabs.map((tab) => tab.document.displayName)).toEqual([
      "Untitled",
      "a.md",
    ]);
    state = appendRestoredTab(
      state,
      restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
      "beta",
    );

    const finalized = finalizeRestoredTabs(state, "tab-3", "tab-1");

    expect(finalized.tabs.map((tab) => tab.document.displayName)).toEqual([
      "a.md",
      "b.txt",
    ]);
    expect(finalized.activeTabId).toBe("tab-3");
    expect(activeDocument(finalized).id).toBe("doc-b");
    expect(activeDocument(finalized).content).toBe("beta");
    expect(
      finalized.tabs.every((tab) => tab.document.isDirty === false),
    ).toBe(true);
    expect(
      finalized.tabs.every((tab) => tab.document.path !== null),
    ).toBe(true);
    // 后续新建标签的编号不与恢复标签冲突，Untitled 计数从头开始。
    expect(finalized.nextUntitledNumber).toBe(1);
    const withNewTab = addUntitledTab(finalized);
    expect(activeDocument(withNewTab).displayName).toBe("Untitled");
    expect(withNewTab.tabs.map((tab) => tab.tabId)).toEqual([
      "tab-2",
      "tab-3",
      "tab-4",
    ]);
  });

  it("falls back to the last restored tab when the suggested active tab misses", () => {
    let state = createInitialTabSession();
    state = appendRestoredTab(
      state,
      restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
      "alpha",
    );
    state = appendRestoredTab(
      state,
      restoredDescriptor("doc-b", "/tmp/b.txt", "b.txt"),
      "beta",
    );

    expect(finalizeRestoredTabs(state, null, "tab-1").activeTabId).toBe("tab-3");
    expect(finalizeRestoredTabs(state, "tab-9", "tab-1").activeTabId).toBe("tab-3");
  });

  it("keeps the current session when no file was restored", () => {
    const state = createInitialTabSession();
    expect(finalizeRestoredTabs(state, null, "tab-1")).toBe(state);
  });

  it("keeps an edited initial placeholder and other Untitled tabs on finalize", () => {
    // 用户编辑过的初始占位：内容/脏状态保留，不被收尾移除。
    let state = createInitialTabSession();
    state = updateActiveDocument(state, (document) => ({
      ...document,
      content: "draft",
      isDirty: true,
    }));
    state = appendRestoredTab(
      state,
      restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
      "alpha",
    );
    const edited = finalizeRestoredTabs(state, "tab-2", "tab-1");
    expect(edited.tabs.map((tab) => tab.tabId)).toEqual(["tab-1", "tab-2"]);
    expect(edited.tabs[0].document.content).toBe("draft");
    expect(edited.tabs[0].document.isDirty).toBe(true);
    // 仍保留无路径标签时，Untitled 计数不重置，后续新建不冲突。
    expect(edited.nextUntitledNumber).toBe(2);

    // 用户新建并编辑的 Untitled 同样保留，未触碰的初始占位照常移除。
    let fresh = createInitialTabSession();
    fresh = addUntitledTab(fresh);
    fresh = switchActiveTab(fresh, "tab-2");
    fresh = updateActiveDocument(fresh, (document) => ({
      ...document,
      content: "scratch",
      isDirty: true,
    }));
    fresh = appendRestoredTab(
      fresh,
      restoredDescriptor("doc-a", "/tmp/a.md", "a.md"),
      "alpha",
    );
    const kept = finalizeRestoredTabs(fresh, "tab-3", "tab-1");
    expect(kept.tabs.map((tab) => tab.tabId)).toEqual(["tab-2", "tab-3"]);
    expect(kept.tabs[0].document.displayName).toBe("Untitled 2");
    expect(kept.tabs[0].document.content).toBe("scratch");
    expect(kept.nextUntitledNumber).toBe(3);
  });
});
