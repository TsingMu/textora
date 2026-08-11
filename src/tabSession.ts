import {
  commitOpenedDocument,
  createNewDocument,
  type DocumentSession,
} from "./documentSession";
import type { DocumentDescriptor } from "./platform";

export type DocumentTab = {
  tabId: string;
  document: DocumentSession;
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
