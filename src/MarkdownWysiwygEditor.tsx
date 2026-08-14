import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

import {
  parseMarkdownWysiwygBlocks,
  serializeMarkdownWysiwygBlocks,
  type MarkdownTaskState,
  type MarkdownWysiwygBlock,
} from "./markdownWysiwyg";

type MarkdownWysiwygEditorProps = {
  content: string;
  disabled?: boolean;
  onChange: (content: string) => void;
};

export function MarkdownWysiwygEditor({
  content,
  disabled = false,
  onChange,
}: MarkdownWysiwygEditorProps) {
  const blocks = parseMarkdownWysiwygBlocks(content);

  function updateBlock(index: number, block: MarkdownWysiwygBlock) {
    const nextBlocks = blocks.map((item, itemIndex) =>
      itemIndex === index ? block : item,
    );
    onChange(serializeMarkdownWysiwygBlocks(nextBlocks));
  }

  return (
    <div className="markdown-wysiwyg-editor" aria-label="Markdown WYSIWYG editor">
      {blocks.length === 0 ? (
        <AutoGrowTextarea
          className="markdown-wysiwyg-empty"
          value=""
          disabled={disabled}
          aria-label="Empty Markdown document"
          placeholder="Start writing Markdown…"
          onChange={(value) => onChange(value)}
        />
      ) : (
        blocks.map((block, index) => (
          <MarkdownWysiwygBlockEditor
            key={`${index}:${block.type}`}
            block={block}
            disabled={disabled}
            onChange={(nextBlock) => updateBlock(index, nextBlock)}
          />
        ))
      )}
    </div>
  );
}

function MarkdownWysiwygBlockEditor({
  block,
  disabled,
  onChange,
}: {
  block: MarkdownWysiwygBlock;
  disabled: boolean;
  onChange: (block: MarkdownWysiwygBlock) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <AutoGrowTextarea
          className={`markdown-wysiwyg-heading is-h${block.level}`}
          value={block.text}
          singleLine
          disabled={disabled}
          aria-label={`Heading level ${block.level}`}
          onChange={(text) => onChange({ ...block, text })}
        />
      );
    case "paragraph":
      return (
        <AutoGrowTextarea
          className="markdown-wysiwyg-paragraph"
          value={block.text}
          disabled={disabled}
          aria-label="Paragraph"
          onChange={(text) => onChange({ ...block, text })}
        />
      );
    case "list":
      return (
        <div className="markdown-wysiwyg-list">
          {block.items.map((item, index) => (
            <div
              className={`markdown-wysiwyg-list-item ${
                item.taskState !== null ? "has-task" : ""
              }`}
              key={index}
            >
              <span className="markdown-wysiwyg-list-marker">
                {block.ordered ? `${index + 1}.` : "•"}
              </span>
              {item.taskState !== null && (
                <input
                  type="checkbox"
                  className="markdown-wysiwyg-task-checkbox"
                  checked={item.taskState === "checked"}
                  disabled={disabled}
                  aria-label={`Task ${index + 1}`}
                  onChange={(event) => {
                    const items = block.items.map((current, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...current,
                            taskState: event.currentTarget.checked
                              ? ("checked" as MarkdownTaskState)
                              : ("unchecked" as MarkdownTaskState),
                          }
                        : current,
                    );
                    onChange({ ...block, items });
                  }}
                />
              )}
              <AutoGrowTextarea
                className="markdown-wysiwyg-list-text"
                value={item.text}
                singleLine
                disabled={disabled}
                aria-label={`List item ${index + 1}`}
                onChange={(text) => {
                  const items = block.items.map((current, itemIndex) =>
                    itemIndex === index ? { ...current, text } : current,
                  );
                  onChange({ ...block, items });
                }}
              />
            </div>
          ))}
        </div>
      );
    case "blockquote":
      return (
        <AutoGrowTextarea
          className="markdown-wysiwyg-blockquote"
          value={block.text}
          disabled={disabled}
          aria-label="Block quote"
          onChange={(text) => onChange({ ...block, text })}
        />
      );
    case "code":
      return (
        <div className="markdown-wysiwyg-code-block">
          <AutoGrowTextarea
            className="markdown-wysiwyg-code-language"
            value={block.language}
            singleLine
            disabled={disabled}
            aria-label="Code block language"
            onChange={(language) => onChange({ ...block, language })}
          />
          <AutoGrowTextarea
            className="markdown-wysiwyg-code"
            value={block.code}
            disabled={disabled}
            aria-label="Code block source"
            spellCheck={false}
            onChange={(code) => onChange({ ...block, code })}
          />
        </div>
      );
    case "horizontal-rule":
      return <div className="markdown-wysiwyg-hr" role="separator" />;
    case "source":
      return (
        <AutoGrowTextarea
          className={`markdown-wysiwyg-source-island is-${block.reason}`}
          value={block.source}
          disabled={disabled}
          aria-label={`${block.reason} source island`}
          spellCheck={false}
          onChange={(source) => onChange({ ...block, source })}
        />
      );
  }
}

type AutoGrowTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "onChange" | "value"
> & {
  value: string;
  singleLine?: boolean;
  onChange: (value: string) => void;
};

function AutoGrowTextarea({
  value,
  singleLine = false,
  className,
  onChange,
  ...rest
}: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const widthRef = useRef<number | null>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    // scrollHeight excludes borders; border-box sizing needs them added back.
    const next = el.scrollHeight + el.offsetHeight - el.clientHeight;
    if (next > 0) {
      el.style.height = `${next}px`;
    }
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [value, className, resize]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined) {
        return;
      }
      if (widthRef.current === null) {
        widthRef.current = width;
        resize();
        return;
      }
      if (width !== widthRef.current) {
        widthRef.current = width;
        resize();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [resize]);

  return (
    <textarea
      ref={ref}
      rows={1}
      className={className}
      value={value}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        onChange(
          singleLine
            ? raw.replace(/\r/g, "").replace(/[ \t]*\n+[ \t]*/g, " ")
            : raw,
        );
      }}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
      }}
      onKeyDown={
        singleLine
          ? (event) => {
              if (
                event.key === "Enter" &&
                !composingRef.current &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
              }
            }
          : undefined
      }
      {...rest}
    />
  );
}
