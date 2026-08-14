/**
 * Markdown opening fence 语言候选弹层 completion source（`docs/features/markdown-fence-language-suggestions.md`
 * 切片 3）。
 *
 * 把前置切片的纯函数契约（`openingFenceTokenContext`/`suggestFenceLanguages`/`buildFenceLanguageInsertion`）
 * 包装为官方 `@codemirror/autocomplete` 的受限 completion source 与扩展。本模块只负责“在 Markdown 源码
 * opening fence 首个 info token 处给出候选、确认时只替换首个 token”，不复制 Markdown 词法或语言词表，
 * 也不自建弹层/键盘状态机。
 *
 * 键盘协调依赖依赖树中既有的优先级链：`basicSetup` 内置的 `completionKeymapExt` 位于 `Prec.highest`
 * （Enter→acceptCompletion、Escape→closeCompletion、方向键→moveCompletionSelection），高于既有 `Prec.high`
 * 的 opening fence Enter 自动闭合。因此候选打开且有选中项时 Enter 先确认候选；候选关闭（无匹配/Escape/确认后）
 * 时 Enter 落到自动闭合→普通换行。Tab→acceptCompletion 由本切片额外绑定，确保 Tab 与 Enter 行为一致。
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { openingFenceTokenContextFromLineSource } from "./markdownFenceContext";
import type { OpeningFenceTokenContext } from "./markdownFenceContext";
import {
  buildFenceLanguageInsertion,
  suggestFenceLanguages,
} from "./markdownFenceLanguageSuggestions";

/**
 * 基于 Markdown 语法树的有界嵌套判定：光标所在行是否处于一个「起于上方」的 `FencedCode` 节点内。
 *
 * - 返回 `true`：光标行位于一个起于上方的 fenced code block 内（外层未闭合/已闭合 fence 的内容），应拒绝候选；
 * - 返回 `false`：光标行是一个新 opening（`FencedCode.from` 等于本行起点）或其上方根本无 fence，可放行；
 * - 返回 `null`：语法树尚未覆盖到光标行（`tree.length < line.to`）。纯文本调用方可回退扫描，但编辑器
 *   completion 热路径应安全退化为不显示候选，避免大文档中无界扫描阻塞输入。
 *
 * 利用 lezer-markdown 结构：闭合的 fenced block 为 `FencedCode(CodeMark, CodeInfo, CodeText, CodeMark)`，
 * 未闭合为 `FencedCode(CodeMark, CodeInfo, CodeText)`；任一情况下，被外层 fence 包住的内容行的最近
 * `FencedCode` 祖先都起于该内容行之前。查询是 O(树深)，不随文档行数增长。
 */
export function fenceOpeningNestingFromTree(
  state: EditorState,
  line: { from: number; to: number },
): boolean | null {
  const tree = syntaxTree(state);
  if (tree.length < line.to) return null;
  let node: SyntaxNode | null = tree.resolveInner(line.to, -1);
  while (node !== null && node.name !== "FencedCode") {
    node = node.parent;
  }
  if (node === null) return false;
  return node.from < line.from;
}

/**
 * 面向编辑器的 opening fence token 上下文：先走当前行 fence 词法与 token 命中（快速拒绝普通段落），
 * 嵌套确认优先用 {@link fenceOpeningNestingFromTree}（Markdown 语法树，O(树深)）。树尚未覆盖当前行时，
 * completion 热路径安全退化为无候选，不回退到逐行扫描；后续语法解析或继续输入可重新触发查询。
 * 不调用 `state.doc.toString()`。
 */
export function openingFenceTokenContextFromState(
  state: EditorState,
  offset: number,
): OpeningFenceTokenContext | null {
  const doc = state.doc;
  const line = doc.lineAt(offset);
  return openingFenceTokenContextFromLineSource(
    doc.lines,
    (n) => doc.line(n).text,
    (n) => doc.line(n).from,
    line.number,
    offset,
    (cursorLine) => {
      const cursorLineDoc = doc.line(cursorLine);
      // 行源核心把 true 解释为“拒绝候选且不扫描”。树未覆盖时同样安全拒绝，避免在 50 MiB 文档末尾
      // 对每个语言字符回退扫描全部前文；纯文本入口仍保留精确逐行回退。
      return fenceOpeningNestingFromTree(state, cursorLineDoc) ?? true;
    },
  );
}

/**
 * 受限 Markdown opening fence completion source。仅在单空光标位于有效非嵌套 opening fence 首个 info token
 * 时返回候选；只读、多选区、非空选区、非 fence 上下文或无匹配前缀均返回 `null`（关闭弹层、不显示空列表）。
 *
 * 上下文识别走 {@link openingFenceTokenContextFromState}（CodeMirror `Text` 行 API + Markdown 语法树有界
 * 嵌套判定），不调用 `state.doc.toString()`：先只读当前行做 fence 词法快速判定，普通段落与非 token 位置
 * 直接返回 `null`；语法树未覆盖时也安全退化为无候选，编辑器热路径绝不扫描全部前文。
 *
 * 裸 opening fence（空前缀）在非显式激活（即输入自动激活）时返回 `null`，避免弹层吞掉既有 Enter 自动闭合；
 * 显式 `Ctrl-Space`（`context.explicit`）下仍展示完整目录。候选由 `suggestFenceLanguages(prefix)` 预过滤
 * （大小写不敏感前缀、目录顺序、去重），结果以 `filter: false` 提交，禁止 autocompletion 的模糊重排，
 * 保证 stable 顺序与前缀语义。确认经每个 option 的 `apply` 用 `buildFenceLanguageInsertion` 把 canonical
 * 写回首 token 范围——光标在 token 中部时仍替换整个 token；`apply` 起始复核 `view.state.readOnly`，防止
 * 候选打开后文档转为只读/忙碌仍被（鼠标）确认写入。
 */
export function markdownFenceLanguageCompletionSource(
  context: CompletionContext,
): CompletionResult | null {
  const state = context.state;
  if (state.readOnly) return null;
  const selection = state.selection;
  if (selection.ranges.length !== 1 || !selection.main.empty) return null;

  const offset = selection.main.head;
  const fenceContext = openingFenceTokenContextFromState(state, offset);
  if (fenceContext === null) return null;
  if (!context.explicit && fenceContext.prefix === "") return null;

  const candidates = suggestFenceLanguages(fenceContext.prefix);
  if (candidates.length === 0) return null;

  return {
    from: fenceContext.from,
    to: fenceContext.to,
    filter: false,
    options: candidates.map<Completion>((canonical) => ({
      label: canonical,
      apply: (view: EditorView) => {
        // 候选打开后文档可能已转为只读/忙碌：确认前复核，避免（鼠标）确认写入只读文档。
        if (view.state.readOnly) return;
        const live = openingFenceTokenContextFromState(
          view.state,
          view.state.selection.main.head,
        );
        if (live === null) return;
        const insertion = buildFenceLanguageInsertion(live, canonical);
        if (insertion === null) return;
        view.dispatch({
          changes: { from: insertion.from, to: insertion.to, insert: insertion.text },
          selection: { anchor: insertion.from + insertion.text.length },
          scrollIntoView: true,
          userEvent: "input.complete",
        });
      },
    })),
  };
}

/** Markdown opening fence 语言候选扩展；应仅在 Markdown 语言下挂载（由 Editor 的 language compartment 门控）。 */
export const markdownFenceLanguageCompletion: Extension = autocompletion({
  override: [markdownFenceLanguageCompletionSource],
});
