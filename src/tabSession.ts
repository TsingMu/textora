import {
  commitOpenedDocument,
  createNewDocument,
  type DocumentSession,
} from "./documentSession";
import type { LanguageMode } from "./languageRecognition";
import type { DocumentDescriptor } from "./platform";

export type DocumentTab = {
  tabId: string;
  document: DocumentSession;
  /** 未保存标签的会话内临时语法模式；已保存标签忽略此字段，仍按实际路径识别。 */
  syntaxMode: LanguageMode;
  markdownPreviewOpen: boolean;
  markdownWysiwygOpen: boolean;
  mermaidPreviewOpen: boolean;
};

export type TabSessionState = {
  tabs: DocumentTab[];
  activeTabId: string;
  nextUntitledNumber: number;
  nextTabNumber: number;
};

export function createInitialTabSession(): TabSessionState {
  return {
    tabs: [
      {
        tabId: "tab-1",
        document: createNewDocument("untitled-1"),
        syntaxMode: "plain-text",
        markdownPreviewOpen: false,
        markdownWysiwygOpen: false,
        mermaidPreviewOpen: false,
      },
    ],
    activeTabId: "tab-1",
    nextUntitledNumber: 2,
    nextTabNumber: 2,
  };
}

function untitledDisplayName(number: number): string {
  return number === 1 ? "Untitled" : `Untitled ${number}`;
}

function createUntitledTab(tabId: string, number: number): DocumentTab {
  return {
    tabId,
    syntaxMode: "plain-text",
    markdownPreviewOpen: false,
    markdownWysiwygOpen: false,
    mermaidPreviewOpen: false,
    document: {
      ...createNewDocument(`untitled-${number}`),
      displayName: untitledDisplayName(number),
    },
  };
}

export function activeDocument(state: TabSessionState): DocumentSession {
  const active = state.tabs.find((tab) => tab.tabId === state.activeTabId);
  return active?.document ?? state.tabs[0].document;
}

export function updateActiveDocument(
  state: TabSessionState,
  update: (document: DocumentSession) => DocumentSession,
): TabSessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.tabId !== state.activeTabId) return tab;
    const document = update(tab.document);
    if (document === tab.document) return tab;
    changed = true;
    return { ...tab, document };
  });
  return changed ? { ...state, tabs } : state;
}

export function updateDocumentByTabId(
  state: TabSessionState,
  tabId: string,
  update: (document: DocumentSession) => DocumentSession,
): TabSessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.tabId !== tabId) return tab;
    const document = update(tab.document);
    if (document === tab.document) return tab;
    changed = true;
    return { ...tab, document };
  });
  return changed ? { ...state, tabs } : state;
}

export function addUntitledTab(state: TabSessionState): TabSessionState {
  const tab = createUntitledTab(
    `tab-${state.nextTabNumber}`,
    state.nextUntitledNumber,
  );
  return {
    tabs: [...state.tabs, tab],
    activeTabId: tab.tabId,
    nextUntitledNumber: state.nextUntitledNumber + 1,
    nextTabNumber: state.nextTabNumber + 1,
  };
}

export function addOpenedDocumentTab(
  state: TabSessionState,
  descriptor: DocumentDescriptor,
  content: string,
): TabSessionState {
  const tabId = `tab-${state.nextTabNumber}`;
  return {
    tabs: [
      ...state.tabs,
      {
        tabId,
        syntaxMode: "plain-text",
        markdownPreviewOpen: false,
        markdownWysiwygOpen: false,
        mermaidPreviewOpen: false,
        document: commitOpenedDocument(
          createNewDocument(descriptor.id),
          descriptor,
          content,
        ),
      },
    ],
    activeTabId: tabId,
    nextUntitledNumber: state.nextUntitledNumber,
    nextTabNumber: state.nextTabNumber + 1,
  };
}

/** 启动恢复逐项追加一个已取回内容的文件标签；不改变活动标签（恢复完成后统一收尾）。 */
export function appendRestoredTab(
  state: TabSessionState,
  descriptor: DocumentDescriptor,
  content: string,
): TabSessionState {
  const tabId = `tab-${state.nextTabNumber}`;
  return {
    tabs: [
      ...state.tabs,
      {
        tabId,
        syntaxMode: "plain-text",
        markdownPreviewOpen: false,
        markdownWysiwygOpen: false,
        mermaidPreviewOpen: false,
        document: commitOpenedDocument(
          createNewDocument(descriptor.id),
          descriptor,
          content,
        ),
      },
    ],
    activeTabId: state.activeTabId,
    nextUntitledNumber: state.nextUntitledNumber,
    nextTabNumber: state.nextTabNumber + 1,
  };
}

/** 占位标签仅在仍干净、为空、未变脏且不处于任何打开/保存流程时才可移除。 */
function isUntouchedPlaceholder(
  tab: DocumentTab,
  placeholderTabId: string,
): boolean {
  return (
    tab.tabId === placeholderTabId &&
    tab.document.path === null &&
    tab.document.content === "" &&
    !tab.document.isDirty &&
    tab.document.openStatus === "idle" &&
    tab.document.saveStatus === "idle"
  );
}

/**
 * 启动恢复收尾：有文件被恢复时，只在初始占位 Untitled 仍未被用户触碰时移除它；恢复
 * 中断期间用户编辑过的初始 Untitled 或新建的其他无路径标签一律保留。活动标签取建议
 * 值，未命中时保留仍存在的当前活动标签（中断后用户焦点），最后回落到最后一个文件
 * 标签。无恢复项时保持原会话（默认 Untitled 启动）。
 */
export function finalizeRestoredTabs(
  state: TabSessionState,
  activeTabId: string | null,
  placeholderTabId: string,
): TabSessionState {
  const restored = state.tabs.filter((tab) => tab.document.path !== null);
  if (restored.length === 0) {
    return state;
  }
  const placeholderUntouched = state.tabs.some((tab) =>
    isUntouchedPlaceholder(tab, placeholderTabId),
  );
  const tabs = placeholderUntouched
    ? state.tabs.filter((tab) => tab.tabId !== placeholderTabId)
    : state.tabs;
  const targetTabId =
    (activeTabId !== null && tabs.some((tab) => tab.tabId === activeTabId)
      ? activeTabId
      : null) ??
    (tabs.some((tab) => tab.tabId === state.activeTabId)
      ? state.activeTabId
      : tabs[tabs.length - 1].tabId);
  return {
    tabs,
    activeTabId: targetTabId,
    // 仍有无路径标签时保持计数，避免下次新建 Untitled 时编号/身份冲突。
    nextUntitledNumber: tabs.some((tab) => tab.document.path === null)
      ? state.nextUntitledNumber
      : 1,
    nextTabNumber: state.nextTabNumber,
  };
}

export function setMarkdownPreviewOpen(
  state: TabSessionState,
  tabId: string,
  open: boolean,
): TabSessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (
      tab.tabId !== tabId ||
      (tab.markdownPreviewOpen === open && (!open || !tab.markdownWysiwygOpen))
    ) {
      return tab;
    }
    changed = true;
    return {
      ...tab,
      markdownPreviewOpen: open,
      markdownWysiwygOpen: open ? false : tab.markdownWysiwygOpen,
    };
  });
  return changed ? { ...state, tabs } : state;
}

export function setMarkdownWysiwygOpen(
  state: TabSessionState,
  tabId: string,
  open: boolean,
): TabSessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (
      tab.tabId !== tabId ||
      (tab.markdownWysiwygOpen === open && (!open || !tab.markdownPreviewOpen))
    ) {
      return tab;
    }
    changed = true;
    return {
      ...tab,
      markdownWysiwygOpen: open,
      markdownPreviewOpen: open ? false : tab.markdownPreviewOpen,
    };
  });
  return changed ? { ...state, tabs } : state;
}

export function setMermaidPreviewOpen(
  state: TabSessionState,
  tabId: string,
  open: boolean,
): TabSessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.tabId !== tabId || tab.mermaidPreviewOpen === open) {
      return tab;
    }
    changed = true;
    return { ...tab, mermaidPreviewOpen: open };
  });
  return changed ? { ...state, tabs } : state;
}

/**
 * 设置一个未保存标签的会话内临时语法模式。选择只属于 `path === null` 的标签；已保存
 * 标签或未命中 tabId 一律保持原状态。模式只影响源码高亮与状态栏，不产生脏状态。
 */
export function setTabSyntaxMode(
  state: TabSessionState,
  tabId: string,
  mode: LanguageMode,
): TabSessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (
      tab.tabId !== tabId ||
      tab.document.path !== null ||
      tab.syntaxMode === mode
    ) {
      return tab;
    }
    changed = true;
    return { ...tab, syntaxMode: mode };
  });
  return changed ? { ...state, tabs } : state;
}

/**
 * 首次保存成功后清除标签的临时语法模式，使语言、高亮与原生菜单改由实际路径识别。与
 * {@link setTabSyntaxMode} 不同，这里不检查 `path`：调用点在同一批次内先提交带路径的
 * 可信描述符再清除，若先检查会因路径已非空而拒绝清除。
 */
export function clearTabSyntaxMode(
  state: TabSessionState,
  tabId: string,
): TabSessionState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.tabId !== tabId || tab.syntaxMode === "plain-text") {
      return tab;
    }
    changed = true;
    return { ...tab, syntaxMode: "plain-text" as const };
  });
  return changed ? { ...state, tabs } : state;
}

export function switchActiveTab(
  state: TabSessionState,
  tabId: string,
): TabSessionState {
  if (
    tabId === state.activeTabId ||
    !state.tabs.some((tab) => tab.tabId === tabId)
  ) {
    return state;
  }
  return { ...state, activeTabId: tabId };
}

export function closeTabCleanly(
  state: TabSessionState,
  tabId: string,
): TabSessionState {
  const index = state.tabs.findIndex((tab) => tab.tabId === tabId);
  if (index === -1) return state;
  if (state.tabs.length === 1) {
    const tab = createUntitledTab(
      `tab-${state.nextTabNumber}`,
      state.nextUntitledNumber,
    );
    return {
      tabs: [tab],
      activeTabId: tab.tabId,
      nextUntitledNumber: state.nextUntitledNumber + 1,
      nextTabNumber: state.nextTabNumber + 1,
    };
  }

  const tabs = state.tabs.filter((tab) => tab.tabId !== tabId);
  let activeTabId = state.activeTabId;
  if (tabId === state.activeTabId) {
    const fallbackIndex = Math.min(index, tabs.length - 1);
    activeTabId = tabs[fallbackIndex].tabId;
  }
  return { ...state, tabs, activeTabId };
}
