import { describe, expect, it } from "vitest";

import {
  classifyFenceLine,
  fenceContextAt,
  unclosedOpeningAtLineEnd,
  type FenceContext,
} from "./markdownFenceContext";

/**
 * 把多行文本拼成以 `\n` 分隔的源码；便于在用例里按行书写而无需手算换行 offset。
 */
function doc(...lines: string[]): string {
  return lines.join("\n");
}

/**
 * 在 `text` 中定位 `line` 第 `occurrence` 次出现的起始 offset，作为光标或边界断言用。
 */
function offsetOf(text: string, needle: string, occurrence = 1): number {
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    const found = text.indexOf(needle, from);
    if (found === -1) {
      throw new Error(`needle ${needle} (occurrence ${occurrence}) not found`);
    }
    from = found + needle.length;
  }
  return from - needle.length;
}

function contextAtLine(text: string, lineNeedle: string, occurrence = 1): FenceContext | null {
  // 把光标放到目标行内容首个字符之后，确保落在该行而非行末换行。
  const lineStart = offsetOf(text, lineNeedle, occurrence);
  return fenceContextAt(text, lineStart + 1);
}

describe("classifyFenceLine", () => {
  it("识别反引号 opening 与 info string", () => {
    expect(classifyFenceLine("```json")).toEqual({
      indent: 0,
      marker: "`",
      length: 3,
      rest: "json",
    });
  });

  it("识别波浪号与缩进，标记之后的剩余文本含额外属性", () => {
    expect(classifyFenceLine("  ~~~rust foo=bar")).toEqual({
      indent: 2,
      marker: "~",
      length: 3,
      rest: "rust foo=bar",
    });
  });

  it("标记字符少于 3 个、超过 3 个前导空格或非标记起首都不是 fence", () => {
    expect(classifyFenceLine("``")).toBeNull();
    expect(classifyFenceLine("    ```")).toBeNull();
    expect(classifyFenceLine("text")).toBeNull();
    expect(classifyFenceLine("")).toBeNull();
  });
});

describe("fenceContextAt", () => {
  it("返回反引号 fence 的完整上下文与内容边界", () => {
    const text = doc("```json", '{"a":1}', "```");
    const ctx = contextAtLine(text, '{"a":1}');

    expect(ctx).toEqual({
      marker: "`",
      openLength: 3,
      indent: 0,
      infoToken: "json",
      opening: { from: 0, to: offsetOf(text, "\n") },
      closing: { from: offsetOf(text, "```", 2), to: text.length },
      content: {
        from: offsetOf(text, "\n") + 1,
        to: offsetOf(text, "```", 2),
      },
    });
  });

  it("支持波浪号 fence 与 0–3 个前导空格缩进", () => {
    const text = doc("   ~~~", "code", "   ~~~");
    const ctx = contextAtLine(text, "code");

    expect(ctx).not.toBeNull();
    expect(ctx?.marker).toBe("~");
    expect(ctx?.indent).toBe(3);
    expect(ctx?.opening.from).toBe(0);
    expect(ctx?.closing?.from).toBe(offsetOf(text, "   ~~~", 2));
  });

  it("记录 opening 标记长度，并接受同长度的 closing", () => {
    const text = doc("````", "x", "````");
    const ctx = contextAtLine(text, "x");

    expect(ctx?.openLength).toBe(4);
    expect(ctx?.closing).not.toBeNull();
  });

  it("把 info token 按大小写不敏感与首 token 归一化", () => {
    for (const info of ["JSON", "Json", "json", "json foo=bar", "  json  lang"]) {
      const text = doc("```" + info, "{}", "```");
      expect(contextAtLine(text, "{")?.infoToken, info).toBe("json");
    }
  });

  it("无 info string 时 token 为空串", () => {
    const text = doc("```", "code", "```");
    expect(contextAtLine(text, "code")?.infoToken).toBe("");
  });

  it("允许更长的 closing fence 结束代码块", () => {
    const text = doc("```", "x", "``````");
    const ctx = contextAtLine(text, "x");
    expect(ctx?.closing?.from).toBe(offsetOf(text, "``````"));
  });

  it("内容中较短的同类标记不结束代码块，光标在该行仍属内容", () => {
    const text = doc("````", "x", "```", "````");
    // 光标在较短的 ``` 行上：它不是 closing（长度 3 < opening 4），应被当作内容。
    // 注意 "```" 的第 1 次出现落在 opening ```` 内，第 2 次才是较短的代码块行。
    const ctx = contextAtLine(text, "```", 2);
    expect(ctx).not.toBeNull();
    expect(ctx?.closing?.from).toBe(offsetOf(text, "````", 2));
    // 内容范围包含较短的 ``` 行。
    const shortLineStart = offsetOf(text, "```", 2);
    expect(ctx?.content.from).toBeLessThanOrEqual(shortLineStart);
    expect(ctx?.content.to).toBeGreaterThan(shortLineStart);
  });

  it("另一种 fence 字符的候选 closing 行不结束当前代码块", () => {
    const text = doc("```", "x", "~~~", "```");
    const ctx = contextAtLine(text, "~~~");
    expect(ctx?.marker).toBe("`");
    expect(ctx?.closing?.from).toBe(offsetOf(text, "```", 2));
  });

  it("带非空 info string 的候选 closing 行不结束当前代码块", () => {
    const text = doc("```", "x", "```json", "```");
    const ctx = contextAtLine(text, "```json");
    expect(ctx?.closing?.from).toBe(offsetOf(text, "```", 3));
  });

  it("closing 标记后只含空白时仍可结束代码块", () => {
    const text = doc("```", "x", "```   ");
    expect(contextAtLine(text, "x")?.closing?.from).toBe(
      offsetOf(text, "```   "),
    );
  });

  it("未闭合 fence 返回 closing 为 null，内容延伸到源码末尾", () => {
    const text = doc("```json", "{}");
    const ctx = contextAtLine(text, "{");
    expect(ctx?.closing).toBeNull();
    expect(ctx?.content.to).toBe(text.length);
  });

  it("光标在 opening fence 行上不视为内容上下文", () => {
    const text = doc("```json", "{}", "```");
    expect(fenceContextAt(text, 0)).toBeNull();
    expect(fenceContextAt(text, offsetOf(text, "```json") + 6)).toBeNull();
  });

  it("光标在 closing fence 行上不视为内容上下文", () => {
    const text = doc("```json", "{}", "```");
    expect(fenceContextAt(text, offsetOf(text, "```", 2))).toBeNull();
  });

  it("普通文本与代码块外的光标返回 null", () => {
    const text = doc("hello", "world");
    expect(fenceContextAt(text, 2)).toBeNull();
  });

  it("4 个前导空格的标记不被识别为 fence", () => {
    const text = doc("    ```", "code");
    expect(fenceContextAt(text, offsetOf(text, "code") + 1)).toBeNull();
  });

  it("相邻的多个代码块各自独立识别", () => {
    const text = doc("```", "a", "```", "plain", "~~~", "b", "~~~");
    // 第一个代码块内容。
    expect(contextAtLine(text, "a")?.marker).toBe("`");
    // 第二个代码块内容（不同字符）。
    const second = contextAtLine(text, "b");
    expect(second?.marker).toBe("~");
    expect(second?.opening.from).toBe(offsetOf(text, "~~~"));
    expect(second?.closing?.from).toBe(offsetOf(text, "~~~", 2));
    // 两个代码块之间的普通文本不是内容。
    expect(contextAtLine(text, "plain")).toBeNull();
  });

  it("越界 offset 返回 null", () => {
    const text = doc("```", "x", "```");
    expect(fenceContextAt(text, -1)).toBeNull();
    expect(fenceContextAt(text, text.length + 1)).toBeNull();
  });
});

describe("unclosedOpeningAtLineEnd", () => {
  it("光标在未闭合 opening 行末时返回标记/长度/缩进", () => {
    const text = "```json";
    expect(unclosedOpeningAtLineEnd(text, text.length)).toEqual({
      marker: "`",
      length: 3,
      indent: 0,
    });
  });

  it("opening 带缩进、波浪号与 info string 仍可识别", () => {
    const tilde = "  ~~~rust";
    expect(unclosedOpeningAtLineEnd(tilde, tilde.length)).toEqual({
      marker: "~",
      length: 3,
      indent: 2,
    });
  });

  it("opening 下方有非 fence 内容且无 closing 时视为未闭合", () => {
    const text = doc("```json", "{}");
    expect(unclosedOpeningAtLineEnd(text, offsetOf(text, "\n"))).toEqual({
      marker: "`",
      length: 3,
      indent: 0,
    });
  });

  it("opening 下方已有匹配 closing 时不返回", () => {
    const text = doc("```json", "{}", "```");
    expect(unclosedOpeningAtLineEnd(text, offsetOf(text, "\n"))).toBeNull();
  });

  it("下方较短的同类标记不是 closing，opening 仍视为未闭合", () => {
    const text = doc("````", "```");
    expect(unclosedOpeningAtLineEnd(text, offsetOf(text, "\n"))).toEqual({
      marker: "`",
      length: 4,
      indent: 0,
    });
  });

  it("光标不在行末时不触发", () => {
    expect(unclosedOpeningAtLineEnd("```json", 3)).toBeNull();
  });

  it("非 fence 行末不触发", () => {
    const text = "hello";
    expect(unclosedOpeningAtLineEnd(text, text.length)).toBeNull();
  });

  it("处于另一个未闭合 fence 内的 fence-like 行不触发", () => {
    const text = doc("```", "```json");
    expect(unclosedOpeningAtLineEnd(text, text.length)).toBeNull();
  });

  it("越界 offset 返回 null", () => {
    expect(unclosedOpeningAtLineEnd("```json", -1)).toBeNull();
    expect(unclosedOpeningAtLineEnd("```json", 100)).toBeNull();
  });
});
