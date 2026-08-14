// @vitest-environment jsdom
import { expect, describe, it, vi } from "vitest";
import { EditorState, EditorSelection, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  CompletionContext,
  currentCompletions,
  completionStatus,
  acceptCompletion,
  type Completion,
} from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { forceParsing, ensureSyntaxTree, syntaxTree } from "@codemirror/language";

import {
  markdownFenceLanguageCompletionSource,
  markdownFenceLanguageCompletion,
  fenceOpeningNestingFromTree,
  openingFenceTokenContextFromState,
} from "./markdownFenceLanguageCompletion";
import { markdownFenceAutoCloseSpec, markdownFenceAutoCloseCommand, markdownFenceAutoCloseFallbackExtension } from "./Editor";

function stateFor(
  doc: string,
  cursor: number = doc.length,
  options: { readOnly?: boolean; ranges?: { from: number; to: number }[] } = {},
): EditorState {
  const ranges =
    options.ranges ?? [{ from: cursor, to: cursor }];
  return EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map((r) => EditorSelection.range(r.from, r.to)),
      0,
    ),
    extensions: [markdown(), EditorState.readOnly.of(options.readOnly ?? false)],
  });
}

function runSource(
  doc: string,
  cursor?: number,
  options?: { readOnly?: boolean; ranges?: { from: number; to: number }[]; explicit?: boolean },
) {
  const state = stateFor(doc, cursor, options);
  const pos = options?.ranges ? options.ranges[0].to : (cursor ?? doc.length);
  return markdownFenceLanguageCompletionSource(
    new CompletionContext(state, pos, options?.explicit ?? false),
  );
}

describe("markdownFenceLanguageCompletionSource", () => {
  it("首个 token 前缀返回目录顺序的去重 canonical，filter:false 禁用模糊重排", () => {
    const result = runSource("```j");
    expect(result?.from).toBe(3);
    expect(result?.to).toBe(4);
    expect(result?.filter).toBe(false);
    expect(result?.options.map((o) => o.label)).toEqual([
      "javascript",
      "json",
      "java",
    ]);
  });

  it("裸 fence 非显式激活不弹候选（避免吞 Enter），显式 Ctrl-Space 给完整目录", () => {
    // 非显式（输入自动激活）：空前缀返回 null，让 Enter 走既有自动闭合。
    expect(runSource("```")).toBeNull();
    // 显式（Ctrl-Space）：展示完整目录，零宽替换范围。
    const explicit = runSource("```", undefined, { explicit: true });
    expect(explicit?.from).toBe(3);
    expect(explicit?.to).toBe(3);
    expect(explicit?.options.map((o) => o.label)).toHaveLength(14);
    expect(explicit?.options.map((o) => o.label)).toContain("mermaid");
  });

  it("完整前缀与大小写不敏感过滤", () => {
    expect(runSource("```json")?.options.map((o) => o.label)).toEqual(["json"]);
    expect(runSource("```JSON")?.options.map((o) => o.label)).toEqual(["json"]);
    expect(runSource("```Rust")?.options.map((o) => o.label)).toEqual(["rust"]);
  });

  it("token 中部仍替换整个 token（from/to 覆盖完整 token）", () => {
    const result = runSource("```javascript", 3 + "java".length);
    expect(result?.from).toBe(3);
    expect(result?.to).toBe(3 + "javascript".length);
    // 中部光标的过滤前缀为光标前文本，仍只命中以该前缀起头的 canonical。
    expect(result?.options.map((o) => o.label)).toEqual([
      "javascript",
      "java",
    ]);
  });

  it("无匹配前缀返回 null（不显示空弹层）", () => {
    expect(runSource("```zzz")).toBeNull();
  });

  it("非 fence 行、closing fence、fence 内容、嵌套 fence、第二 token 均不产生候选", () => {
    expect(runSource("hello world", 3)).toBeNull();
    expect(runSource("```js html", "```js html".indexOf("html") + 1)).toBeNull();
    expect(runSource("```\ncode\n```", "```\ncode\n```".lastIndexOf("```"))).toBeNull();
    expect(runSource("```json\n{}\n```", "```json\n{}\n```".indexOf("{}") + 1)).toBeNull();
    expect(runSource("```\n```json", "```\n```json".indexOf("json"))).toBeNull();
  });

  it("只读状态不产生候选", () => {
    expect(runSource("```j", undefined, { readOnly: true })).toBeNull();
  });

  it("多选区与非空选区不产生候选", () => {
    expect(
      runSource("```j", undefined, {
        ranges: [
          { from: 0, to: 0 },
          { from: 4, to: 4 },
        ],
      }),
    ).toBeNull();
    expect(
      runSource("```j", undefined, { ranges: [{ from: 3, to: 4 }] }),
    ).toBeNull();
  });

  it("普通段落走行 API 快速拒绝，不调用全文 toString()", () => {
    const doc = "# Title\n\na plain paragraph with some text here\n\n```js\nx\n```";
    const paragraphStart = doc.indexOf("a plain");
    const state = stateFor(doc, paragraphStart + 5);
    const toStringSpy = vi.spyOn(state.doc, "toString");
    const result = markdownFenceLanguageCompletionSource(
      new CompletionContext(state, state.selection.main.head, false),
    );
    expect(result).toBeNull();
    expect(toStringSpy).not.toHaveBeenCalled();
  });
});

describe("markdownFenceLanguageCompletionSource 确认与协调", () => {
  function viewWith(doc: string, cursor = doc.length): EditorView {
    return new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        // 生产 Editor 仅在 Markdown language compartment 中挂候选；夹具也必须提供 Markdown 语法树。
        extensions: [markdown(), history()],
      }),
    });
  }

  function applyOption(option: Completion | undefined, view: EditorView): void {
    const apply = option?.apply;
    if (typeof apply === "function") {
      (apply as (view: EditorView) => void)(view);
    }
  }

  it("确认候选用 canonical 替换首个 token，光标停在 canonical 之后", () => {
    const view = viewWith("```j");
    const result = markdownFenceLanguageCompletionSource(
      new CompletionContext(view.state, 4, false),
    );
    const javascript = result?.options.find((o) => o.label === "javascript");
    expect(javascript).toBeDefined();
    applyOption(javascript, view);
    expect(view.state.doc.toString()).toBe("```javascript");
    expect(view.state.selection.main.head).toBe(3 + "javascript".length);
    view.destroy();
  });

  it("确认候选可一次撤销恢复首个 token 前缀", () => {
    const view = viewWith("```j");
    const result = markdownFenceLanguageCompletionSource(
      new CompletionContext(view.state, 4, false),
    );
    applyOption(result?.options[0], view);
    expect(view.state.doc.toString()).toBe("```javascript");
    undo(view);
    expect(view.state.doc.toString()).toBe("```j");
    view.destroy();
  });

  it("确认候选关闭弹层后，下一 Enter 走既有 opening fence 自动闭合", () => {
    const view = viewWith("```j");
    const result = markdownFenceLanguageCompletionSource(
      new CompletionContext(view.state, 4, false),
    );
    applyOption(result?.options[0], view);
    // 确认后光标在行末、opening 仍未闭合 → 既有 Enter 自动闭合仍会接管。
    expect(view.state.selection.main.head).toBe(view.state.doc.lineAt(0).to);
    expect(markdownFenceAutoCloseSpec(view.state)).not.toBeNull();
    view.destroy();
  });

  it("候选打开后文档转只读，确认不写入", () => {
    // 候选在可写状态生成。
    const writableResult = markdownFenceLanguageCompletionSource(
      new CompletionContext(stateFor("```j"), 4, false),
    );
    // 确认时文档已转为只读。
    const view = new EditorView({
      state: EditorState.create({
        doc: "```j",
        selection: EditorSelection.cursor(4),
        extensions: [EditorState.readOnly.of(true), history()],
      }),
    });
    applyOption(writableResult?.options[0], view);
    expect(view.state.doc.toString()).toBe("```j");
    view.destroy();
  });

  it("currentCompletions 在无活动候选时为空（确认后弹层关闭）", () => {
    const view = viewWith("```j");
    expect(currentCompletions(view.state)).toEqual([]);
    view.destroy();
  });
});

describe("真实输入下候选与自动闭合的协调", () => {
  function markdownEditorView(doc: string, cursor = doc.length): EditorView {
    // 复刻 Editor 在 Markdown 下的扩展集合：basicSetup 提供 autocompletion + completionKeymap
    // （Enter/Escape/方向键位于 Prec.highest），既有 Prec.high opening fence Enter 自动闭合，
    // 以及候选 completion 与 Tab 确认键。
    return new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        extensions: [
          basicSetup,
          markdown(),
          markdownFenceAutoCloseFallbackExtension,
          Prec.high(
            keymap.of([
              { key: "Enter", run: markdownFenceAutoCloseCommand(() => "markdown") },
            ]),
          ),
          markdownFenceLanguageCompletion,
          Prec.high(keymap.of([{ key: "Tab", run: acceptCompletion }])),
        ],
      }),
    });
  }

  function typeText(view: EditorView, text: string): void {
    const pos = view.state.selection.main.head;
    view.dispatch({
      changes: { from: pos, to: pos, insert: text },
      selection: { anchor: pos + text.length },
      userEvent: "input.type",
    });
  }

  // 等过 activateOnTypingDelay 再等到查询完成（status 非 pending）。
  async function settleAutoActivation(view: EditorView): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 160));
    const start = Date.now();
    while (Date.now() - start < 400) {
      if (completionStatus(view.state) !== "pending") return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  function pressEnter(view: EditorView): void {
    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  }

  it("裸 opening fence（输入自动激活）不弹候选，Enter 走既有自动闭合", async () => {
    const view = markdownEditorView("");
    typeText(view, "```");
    await settleAutoActivation(view);
    // 空前缀 + 非显式 → 源返回 null，无弹层，Enter 不会被吞。
    expect(completionStatus(view.state)).not.toBe("active");
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("```\n\n```");
    view.destroy();
  });

  it("输入语言前缀后 Enter 确认候选", async () => {
    const view = markdownEditorView("");
    typeText(view, "```j");
    await settleAutoActivation(view);
    expect(completionStatus(view.state)).toBe("active");
    // 越过 interactionDelay，使 acceptCompletion 响应 Enter。
    await new Promise((resolve) => setTimeout(resolve, 120));
    pressEnter(view);
    expect(view.state.doc.toString()).toBe("```javascript");
    view.destroy();
  });
});

describe("fenceOpeningNestingFromTree（语法树有界嵌套判定）", () => {
  async function parsedMarkdownView(doc: string, cursor = doc.length): Promise<EditorView> {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        extensions: [markdown()],
      }),
    });
    forceParsing(view);
    await ensureSyntaxTree(view.state, view.state.doc.length, 1000);
    return view;
  }

  it("无外层 fence 的 opening 返回 false（放行，不进全文扫描）", async () => {
    const view = await parsedMarkdownView("# title\n```js");
    const line = view.state.doc.lineAt(view.state.doc.length);
    expect(syntaxTree(view.state).length).toBe(view.state.doc.length);
    expect(fenceOpeningNestingFromTree(view.state, { from: line.from, to: line.to })).toBe(false);
    view.destroy();
  });

  it("处于上方未闭合 fence 内的 fence 行返回 true（拒绝）", async () => {
    const doc = "```\n```json";
    const view = await parsedMarkdownView(doc, doc.indexOf("json"));
    const line = view.state.doc.lineAt(doc.indexOf("json"));
    expect(fenceOpeningNestingFromTree(view.state, { from: line.from, to: line.to })).toBe(true);
    view.destroy();
  });

  it("已闭合 fence 之后的 opening 返回 false", async () => {
    const view = await parsedMarkdownView("```\ncode\n```\n```js");
    const line = view.state.doc.lineAt(view.state.doc.length);
    expect(fenceOpeningNestingFromTree(view.state, { from: line.from, to: line.to })).toBe(false);
    view.destroy();
  });

  it("openingFenceTokenContextFromState 在树覆盖时给出与逐行扫描一致的嵌套拒绝", async () => {
    const doc = "```\n```json";
    const view = await parsedMarkdownView(doc, doc.indexOf("json"));
    expect(openingFenceTokenContextFromState(view.state, doc.indexOf("json"))).toBeNull();
    view.destroy();
  });

  it("大文档语法树未覆盖末尾时安全退化，不逐行扫描全部前文", () => {
    const doc =
      Array.from({ length: 20_000 }, (_, index) => `line ${index + 1}`).join("\n") +
      "\n```js";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown()],
    });
    const line = state.doc.lineAt(doc.length);
    expect(syntaxTree(state).length).toBeLessThan(line.to);

    const lineSpy = vi.spyOn(state.doc, "line");
    expect(openingFenceTokenContextFromState(state, doc.length)).toBeNull();
    // 当前行文本、起点和树判定最多读取常数次；若回退逐行扫描，调用数会接近 20,000。
    expect(lineSpy.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
