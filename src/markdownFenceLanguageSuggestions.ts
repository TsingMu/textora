/**
 * Markdown opening fence 语言候选提示的词表与插入计划契约
 * （`docs/features/markdown-fence-language-suggestions.md` 切片 2）。
 *
 * 纯函数：消费 {@link OpeningFenceTokenContext}（由 `markdownFenceContext` 提供）与
 * {@link FENCE_LANGUAGE_DIRECTORY}（由 `markdownCodeHighlight` 提供的单一语言目录），产出可由后续
 * CodeMirror completion source 直接使用的过滤候选与编辑计划。本模块不依赖 CodeMirror、不读取文件、
 * 不渲染弹层、不派发事务；候选确认形成的编辑事务由调用方（UI 接入切片）经普通 CodeMirror 事务提交。
 */

import type { OpeningFenceTokenContext } from "./markdownFenceContext";
import { FENCE_LANGUAGE_DIRECTORY } from "./markdownCodeHighlight";

/** 语言候选插入计划：用 canonical 名称替换首个 info token 范围。 */
export type FenceLanguageInsertion = {
  /** 替换起点，等于建议上下文的 `from`。 */
  from: number;
  /** 替换终点，等于建议上下文的 `to`。 */
  to: number;
  /** 待插入的 canonical 名称文本。 */
  text: string;
};

/**
 * 按大小写不敏感前缀过滤候选，返回去重的 canonical 名称列表（按目录顺序稳定）。空前缀返回全部
 * canonical；canonical 名称或任一别名以前缀起头即命中。别名只影响检索——绝不出现在结果中，确认时也
 * 只写回 canonical。无匹配返回空数组（调用方据此关闭候选，不显示空弹层）。
 */
export function suggestFenceLanguages(prefix: string): readonly string[] {
  const lower = prefix.toLowerCase();
  const result: string[] = [];
  for (const entry of FENCE_LANGUAGE_DIRECTORY) {
    if (lower === "") {
      result.push(entry.canonical);
      continue;
    }
    if (
      entry.canonical.startsWith(lower) ||
      entry.aliases.some((alias) => alias.startsWith(lower))
    ) {
      result.push(entry.canonical);
    }
  }
  return result;
}

/**
 * 为已确认的 canonical 名称构造「仅替换首个 info token」的编辑计划。`from`/`to` 直接取自建议上下文，
 * 因此光标在 token 中部时仍替换整个首个 token；`text` 为 canonical 名称。canonical 为空时不生成编辑
 * （返回 `null`），避免空提交。调用方据此派生普通 CodeMirror 事务，自然进入撤销历史与脏状态链路。
 */
export function buildFenceLanguageInsertion(
  context: OpeningFenceTokenContext,
  canonical: string,
): FenceLanguageInsertion | null {
  if (canonical === "") return null;
  return { from: context.from, to: context.to, text: canonical };
}
