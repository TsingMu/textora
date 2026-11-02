import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

import {
  parseMarkdownWysiwygDocument,
  replaceWysiwygBlock,
  serializeMarkdownWysiwygBlock,
  type MarkdownTaskState,
  type MarkdownWysiwygBlock,
} from "./markdownWysiwyg";
import {
  changeMarkdownTableAlignment,
  changeMarkdownTableColumn,
  changeMarkdownTableRow,
  replaceMarkdownTableCell,
} from "./markdownTable";
import { MarkdownWysiwygTableEditor } from "./MarkdownWysiwygTableEditor";
import { MarkdownWysiwygInlineEditor } from "./MarkdownWysiwygInlineEditor";

type MarkdownWysiwygEditorProps = {
  content: string;
  disabled?: boolean;
  onChange: (content: string) => boolean | void;
};

export function MarkdownWysiwygEditor({
  content,
  disabled = false,
  onChange,
}: MarkdownWysiwygEditorProps) {
  const { blocks, ranges } = parseMarkdownWysiwygDocument(content);
  const expectedContent = useRef(content);
  const documentRevision = useRef(0);
  if (content !== expectedContent.current) {
    expectedContent.current = content;
    documentRevision.current += 1;
  }
  const submit = (next: string): boolean => {
    if (disabled || onChange(next) === false) return false;
    expectedContent.current = next;
    return true;
  };

  function updateBlock(index: number, block: MarkdownWysiwygBlock) {
    if (disabled) return;
    const range = ranges[index];
    if (!range) return;
    const next = replaceWysiwygBlock(
      content,
      range,
      content.slice(range.from, range.to),
      serializeMarkdownWysiwygBlock(block),
    );
    if (next !== null && next !== content) submit(next);
  }

  return (
    <div
      className="markdown-wysiwyg-editor"
      aria-label="Markdown WYSIWYG editor"
    >
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
        blocks.map((block, index) =>
          block.type === "table" ? (
            <MarkdownWysiwygTableEditor
              key={`${index}:table`}
              table={block.table}
              disabled={disabled}
              contextRevision={documentRevision.current}
              documentSource={content}
              onRowChange={(command) => {
                if (disabled) return null;
                const next = changeMarkdownTableRow(
                  content,
                  block.table,
                  command,
                );
                return next !== null && submit(next) ? next : null;
              }}
              onColumnChange={(command) => {
                if (disabled) return null;
                const next = changeMarkdownTableColumn(
                  content,
                  block.table,
                  command,
                );
                return next !== null && submit(next) ? next : null;
              }}
              onAlignmentChange={(column, alignment) => {
                if (disabled) return null;
                const next = changeMarkdownTableAlignment(
                  content,
                  block.table,
                  column,
                  alignment,
                );
                return next !== null && submit(next) ? next : null;
              }}
              onCellChange={(row, column, inlineSource) => {
                if (disabled) return false;
                const next = replaceMarkdownTableCell(
                  content,
                  block.table,
                  row,
                  column,
                  inlineSource,
                );
                if (next === null) return false;
                return next === content || submit(next);
              }}
            />
          ) : (
            <MarkdownWysiwygBlockEditor
              key={`${index}:${block.type}`}
              block={block}
              disabled={disabled}
              onChange={(nextBlock) => updateBlock(index, nextBlock)}
            />
          ),
        )
      )}
    </div>
  );
}

function MarkdownWysiwygBlockEditor({
  block,
  disabled,
  onChange,
}: {
  block: Exclude<MarkdownWysiwygBlock, { type: "table" }>;
  disabled: boolean;
  onChange: (block: MarkdownWysiwygBlock) => void;
}) {
  switch (block.type) {
    case "heading":
      return (
        <div className={`markdown-wysiwyg-heading is-h${block.level}`}>
          <MarkdownWysiwygInlineEditor
            source={block.text}
            disabled={disabled}
            ariaLabel={`Heading level ${block.level}`}
            singleLine
            onChange={(text) => onChange({ ...block, text })}
          />
        </div>
      );
    case "paragraph":
      return (
        <div className="markdown-wysiwyg-paragraph">
          <MarkdownWysiwygInlineEditor
            source={block.text}
            disabled={disabled}
            ariaLabel="Paragraph"
            onChange={(text) => onChange({ ...block, text })}
          />
        </div>
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
              <div className="markdown-wysiwyg-list-text">
                <MarkdownWysiwygInlineEditor
                  source={item.text}
                  disabled={disabled}
                  ariaLabel={`List item ${index + 1}`}
                  singleLine
                  onChange={(text) => {
                    const items = block.items.map((current, itemIndex) =>
                      itemIndex === index ? { ...current, text } : current,
                    );
                    onChange({ ...block, items });
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      );
    case "blockquote":
      return (
        <div className="markdown-wysiwyg-blockquote">
          <MarkdownWysiwygInlineEditor
            source={block.text}
            disabled={disabled}
            ariaLabel="Block quote"
            onChange={(text) => onChange({ ...block, text })}
          />
        </div>
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
