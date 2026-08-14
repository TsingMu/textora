import { describe, expect, it } from "vitest";

import {
  classifyFenceLine,
  fenceContextAt,
  openingFenceTokenContext,
  openingFenceTokenContextFromLineSource,
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

describe("openingFenceTokenContext", () => {
  it("标记后空 token 返回零宽范围与空前缀", () => {
    expect(openingFenceTokenContext("```", 3)).toEqual({
      marker: "`",
      prefix: "",
      from: 3,
      to: 3,
    });
  });

  it("光标在已输入 token 末尾返回该 token 作为前缀与替换范围", () => {
    expect(openingFenceTokenContext("```js", 5)).toEqual({
      marker: "`",
      prefix: "js",
      from: 3,
      to: 5,
    });
  });

  it("光标在 token 起点返回空前缀但范围覆盖整个 token", () => {
    expect(openingFenceTokenContext("```ts", 3)).toEqual({
      marker: "`",
      prefix: "",
      from: 3,
      to: 5,
    });
  });

  it("光标在 token 中部只取光标前文本作为前缀，但替换范围覆盖整个 token", () => {
    const text = "```javascript";
    const cursor = 3 + "java".length;
    const context = openingFenceTokenContext(text, cursor);
    expect(context?.prefix).toBe("java");
    expect(context?.from).toBe(3);
    expect(context?.to).toBe(3 + "javascript".length);
  });

  it("波浪号与 0–3 个前导空格缩进可识别", () => {
    const tilde = "  ~~~rs";
    const context = openingFenceTokenContext(tilde, tilde.length);
    expect(context?.marker).toBe("~");
    expect(context?.prefix).toBe("rs");
    expect(context?.from).toBe(2 + 3);
    expect(context?.to).toBe(tilde.length);

    const indent3 = "   ```ts";
    const c3 = openingFenceTokenContext(indent3, indent3.length);
    expect(c3?.from).toBe(3 + 3);
  });

  it("4 个前导空格不被识别为 opening fence", () => {
    const text = "    ```ts";
    expect(openingFenceTokenContext(text, text.length)).toBeNull();
  });

  it("标记后的前导空白被跳过，token 从首个非空白起算", () => {
    const text = "``` json";
    const context = openingFenceTokenContext(text, text.length);
    expect(context?.from).toBe(4);
    expect(context?.to).toBe(8);
    expect(context?.prefix).toBe("json");
    // 光标落在标记与前导空白之间时不产生上下文。
    expect(openingFenceTokenContext(text, 3)).toBeNull();
  });

  it("光标在标记内部不产生上下文", () => {
    expect(openingFenceTokenContext("```ts", 1)).toBeNull();
    expect(openingFenceTokenContext("````ts", 3)).toBeNull();
  });

  it("token 末尾位置有效，但其后的空格与第二 token 不产生上下文", () => {
    const text = "```js  html";
    // 光标在 token 末尾（"js" 之后第一个位置）仍有效。
    expect(openingFenceTokenContext(text, 5)?.prefix).toBe("js");
    // 光标在随后的空格中无效。
    expect(openingFenceTokenContext(text, 6)).toBeNull();
    // 光标在第二 token 中无效。
    expect(openingFenceTokenContext(text, offsetOf(text, "html") + 1)).toBeNull();
  });

  it("closing fence 行不产生上下文", () => {
    const text = doc("```ts", "code", "```");
    const closingStart = offsetOf(text, "```", 2);
    expect(openingFenceTokenContext(text, closingStart)).toBeNull();
    expect(openingFenceTokenContext(text, closingStart + 1)).toBeNull();
  });

  it("fence 内容区不产生上下文", () => {
    const text = doc("```ts", "const x = 1;", "```");
    const content = offsetOf(text, "const") + 2;
    expect(openingFenceTokenContext(text, content)).toBeNull();
  });

  it("位于另一未闭合 fence 内的 fence-like 行不产生上下文", () => {
    const text = doc("```", "```ts");
    const innerToken = offsetOf(text, "```ts") + 3 + 1;
    expect(openingFenceTokenContext(text, innerToken)).toBeNull();
  });

  it("已闭合 opening fence 仍可在其语言 token 上产生上下文", () => {
    const text = doc("```ts", "code", "```");
    const tokenStart = offsetOf(text, "```ts") + 3;
    const context = openingFenceTokenContext(text, tokenStart + 1);
    expect(context?.prefix).toBe("t");
    expect(context?.from).toBe(tokenStart);
    expect(context?.to).toBe(tokenStart + 2);
  });

  it("相邻第二个代码块的 opening 可独立识别", () => {
    const text = doc("```ts", "a", "```", "~~~py");
    const secondOpening = offsetOf(text, "~~~py");
    const context = openingFenceTokenContext(text, secondOpening + 3 + 1);
    expect(context?.marker).toBe("~");
    expect(context?.prefix).toBe("p");
    expect(context?.from).toBe(secondOpening + 3);
  });

  it("非 fence 行不产生上下文", () => {
    expect(openingFenceTokenContext("hello world", 3)).toBeNull();
  });

  it("越界 offset 返回 null", () => {
    expect(openingFenceTokenContext("```ts", -1)).toBeNull();
    expect(openingFenceTokenContext("```ts", 100)).toBeNull();
  });
});

describe("openingFenceTokenContextFromLineSource", () => {
  // 由行数组派生 1-based 行号访问器；starts[i] 为第 i+1 行的绝对起始 offset。
  function lineSource(lines: string[]) {
    const starts: number[] = [];
    let acc = 0;
    for (const line of lines) {
      starts.push(acc);
      acc += line.length + 1;
    }
    return {
      lineCount: lines.length,
      getText: (n: number) => lines[n - 1],
      getStart: (n: number) => starts[n - 1],
      offsetInLine: (n: number, pos: number) => starts[n - 1] + pos,
    };
  }

  it("普通段落只读当前行，不扫描上方（快速拒绝）", () => {
    const lines = ["# Title", "plain paragraph text", "```js", "code", "```"];
    const src = lineSource(lines);
    let textCalls = 0;
    const result = openingFenceTokenContextFromLineSource(
      src.lineCount,
      (n) => {
        textCalls++;
        return src.getText(n);
      },
      src.getStart,
      2, // 光标在普通段落行
      src.offsetInLine(2, 5),
    );
    expect(result).toBeNull();
    expect(textCalls).toBe(1);
  });

  it("fence 行且光标不在首个 token 内也只读当前行（不扫描上方）", () => {
    const lines = ["# Title", "```js html", "code"];
    const src = lineSource(lines);
    let textCalls = 0;
    const result = openingFenceTokenContextFromLineSource(
      src.lineCount,
      (n) => {
        textCalls++;
        return src.getText(n);
      },
      src.getStart,
      2, // 光标在第二 token "html" 内
      src.offsetInLine(2, "```js ".length + 1),
    );
    expect(result).toBeNull();
    expect(textCalls).toBe(1);
  });

  it("fence 行且光标在首个 token 内时才向上扫描确认非嵌套", () => {
    // 第 4 行是新 opening（第 1 行的 fence 已被第 3 行闭合）。
    const lines = ["```", "code", "```", "```js"];
    const src = lineSource(lines);
    let textCalls = 0;
    const result = openingFenceTokenContextFromLineSource(
      src.lineCount,
      (n) => {
        textCalls++;
        return src.getText(n);
      },
      src.getStart,
      4,
      src.offsetInLine(4, "```".length + 1), // 光标在 "js" 内
    );
    expect(result?.prefix).toBe("j");
    // 当前行 + 上方 3 行都被读取以确认非嵌套。
    expect(textCalls).toBe(4);
  });

  it("位于另一未闭合 fence 内的 fence 行经上方扫描后被拒绝", () => {
    const lines = ["```", "```json"];
    const src = lineSource(lines);
    const result = openingFenceTokenContextFromLineSource(
      src.lineCount,
      src.getText,
      src.getStart,
      2,
      src.offsetInLine(2, "```".length + 1),
    );
    expect(result).toBeNull();
  });

  it("大文档下 nestingOracle 命中时只读当前行，不进入 O(行数) 上方扫描", () => {
    // 2000 行普通文本 + 末行 opening fence；光标在末行 token 内。
    const lines: string[] = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    lines.push("```js");
    const src = lineSource(lines);
    let textCalls = 0;
    const result = openingFenceTokenContextFromLineSource(
      src.lineCount,
      (n) => {
        textCalls++;
        return src.getText(n);
      },
      src.getStart,
      src.lineCount,
      src.offsetInLine(src.lineCount, "```".length + 1),
      () => false, // oracle 命中：确认无外层 fence
    );
    expect(result?.prefix).toBe("j");
    // 仅读当前行（getLineText 1 次 + getLineStart 内未走 getText）；不扫描 2000 行。
    expect(textCalls).toBe(1);
  });

  it("nestingOracle 返回 null（语法树未覆盖）时回退到逐行扫描", () => {
    const lines: string[] = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    lines.push("```js");
    const src = lineSource(lines);
    let textCalls = 0;
    const result = openingFenceTokenContextFromLineSource(
      src.lineCount,
      (n) => {
        textCalls++;
        return src.getText(n);
      },
      src.getStart,
      src.lineCount,
      src.offsetInLine(src.lineCount, "```".length + 1),
      () => null, // oracle 无法判定 → 回退逐行扫描
    );
    expect(result?.prefix).toBe("j");
    // 当前行 + 上方全部行都被读取。
    expect(textCalls).toBe(src.lineCount);
  });

  it("nestingOracle 判定嵌套时直接拒绝，不扫描", () => {
    const lines: string[] = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`);
    lines.push("```", "```json");
    const src = lineSource(lines);
    let textCalls = 0;
    const result = openingFenceTokenContextFromLineSource(
      src.lineCount,
      (n) => {
        textCalls++;
        return src.getText(n);
      },
      src.getStart,
      src.lineCount, // 末行 "```json"，处于上方未闭合 fence 内
      src.offsetInLine(src.lineCount, "```".length + 1),
      () => true, // oracle 判定嵌套
    );
    expect(result).toBeNull();
    expect(textCalls).toBe(1); // 仅当前行
  });
});
