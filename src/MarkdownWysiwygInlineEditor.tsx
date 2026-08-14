import { useLayoutEffect, useRef } from "react";

import {
  escapeInlineText,
  escapeLinkLabel,
  parseInline,
  serializeInline,
  type InlineNode,
} from "./markdownWysiwygInline";

type MarkdownWysiwygInlineEditorProps = {
  source: string;
  disabled?: boolean;
  ariaLabel?: string;
  singleLine?: boolean;
  onChange: (source: string) => void;
};

// 内联片段编辑视图：把一段 Markdown 内联源码解析为节点，按样式隐藏标记后逐节点
// 提供可见文字编辑；编辑经单次 onChange 回写为 Markdown。结构（节点顺序与类型）固定，
// 不提供创建/移除/切换格式的命令；只编辑已有片段的可见文字。
export function MarkdownWysiwygInlineEditor({
  source,
  disabled = false,
  ariaLabel,
  singleLine = false,
  onChange,
}: MarkdownWysiwygInlineEditorProps) {
  const nodes = parseInline(source);

  return (
    <span className="wysiwyg-inline-run" aria-label={ariaLabel}>
      {nodes.map((node, index) => (
        <InlineNodeSpan
          key={index}
          node={node}
          disabled={disabled}
          singleLine={singleLine}
          onVisibleChange={(visible) => {
            const next = nodes.map((item, itemIndex) =>
              itemIndex === index
                ? withVisibleText(item, visible, singleLine)
                : item,
            );
            onChange(serializeInline(next));
          }}
        />
      ))}
    </span>
  );
}

function InlineNodeSpan({
  node,
  disabled,
  singleLine,
  onVisibleChange,
}: {
  node: InlineNode;
  disabled: boolean;
  singleLine: boolean;
  onVisibleChange: (visible: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const composingRef = useRef(false);
  const visible = nodeVisibleText(node);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== visible) {
      el.textContent = visible;
    }
  }, [visible]);

  return (
    <span
      ref={ref}
      className={classNameFor(node)}
      contentEditable={disabled ? false : "plaintext-only"}
      suppressContentEditableWarning
      onInput={() => {
        const el = ref.current;
        if (el) {
          onVisibleChange(el.textContent ?? "");
        }
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
      onKeyDown={(event) => {
        if (
          singleLine &&
          event.key === "Enter" &&
          !composingRef.current &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
        }
      }}
      onBeforeInput={(event) => {
        const nativeEvent = event.nativeEvent as InputEvent;
        const inputType = nativeEvent.inputType;
        if (
          singleLine &&
          !composingRef.current &&
          !nativeEvent.isComposing &&
          (inputType === "insertParagraph" || inputType === "insertLineBreak")
        ) {
          event.preventDefault();
        }
      }}
      onPaste={(event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        event.preventDefault();
        document.execCommand?.(
          "insertText",
          false,
          singleLine ? stripNewlines(text) : normalizeNewlines(text),
        );
      }}
    />
  );
}

function classNameFor(node: InlineNode): string {
  switch (node.type) {
    case "text":
      return "wysiwyg-inline-text";
    case "bold":
      return "wysiwyg-inline-bold";
    case "italic":
      return "wysiwyg-inline-italic";
    case "strike":
      return "wysiwyg-inline-strike";
    case "code":
      return "wysiwyg-inline-code";
    case "link":
      return "wysiwyg-inline-link";
  }
}

function nodeVisibleText(node: InlineNode): string {
  const raw = node.type === "link" ? node.label : node.text;
  // code span 内容为字面文本，不解释转义；其余节点的反斜杠转义按可见文字解析。
  return node.type === "code" ? raw : unescapeRaw(raw);
}

function withVisibleText(
  node: InlineNode,
  visible: string,
  singleLine: boolean,
): InlineNode {
  const normalized = singleLine
    ? stripNewlines(visible)
    : normalizeNewlines(visible);
  const raw =
    node.type === "code"
      ? normalized
      : node.type === "link"
        ? escapeLinkLabel(normalized)
        : escapeInlineText(normalized);
  if (node.type === "link") {
    return { ...node, label: raw };
  }
  return { ...node, text: raw };
}

function stripNewlines(text: string): string {
  return normalizeNewlines(text).replace(/[ \t]*\n+[ \t]*/g, " ");
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function unescapeRaw(raw: string): string {
  return raw.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    "$1",
  );
}
