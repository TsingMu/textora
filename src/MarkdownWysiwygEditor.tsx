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
        <textarea
          className="markdown-wysiwyg-empty"
          value=""
          disabled={disabled}
          aria-label="Empty Markdown document"
          placeholder="Start writing Markdown…"
          onChange={(event) => onChange(event.currentTarget.value)}
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
        <input
          className={`markdown-wysiwyg-heading is-h${block.level}`}
          value={block.text}
          disabled={disabled}
          aria-label={`Heading level ${block.level}`}
          onChange={(event) =>
            onChange({ ...block, text: event.currentTarget.value })
          }
        />
      );
    case "paragraph":
      return (
        <textarea
          className="markdown-wysiwyg-paragraph"
          value={block.text}
          disabled={disabled}
          aria-label="Paragraph"
          onChange={(event) =>
            onChange({ ...block, text: event.currentTarget.value })
          }
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
              <input
                className="markdown-wysiwyg-list-text"
                value={item.text}
                disabled={disabled}
                aria-label={`List item ${index + 1}`}
                onChange={(event) => {
                  const items = block.items.map((current, itemIndex) =>
                    itemIndex === index
                      ? { ...current, text: event.currentTarget.value }
                      : current,
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
        <textarea
          className="markdown-wysiwyg-blockquote"
          value={block.text}
          disabled={disabled}
          aria-label="Block quote"
          onChange={(event) =>
            onChange({ ...block, text: event.currentTarget.value })
          }
        />
      );
    case "code":
      return (
        <div className="markdown-wysiwyg-code-block">
          <input
            className="markdown-wysiwyg-code-language"
            value={block.language}
            disabled={disabled}
            aria-label="Code block language"
            onChange={(event) =>
              onChange({ ...block, language: event.currentTarget.value })
            }
          />
          <textarea
            className="markdown-wysiwyg-code"
            value={block.code}
            disabled={disabled}
            aria-label="Code block source"
            spellCheck={false}
            onChange={(event) =>
              onChange({ ...block, code: event.currentTarget.value })
            }
          />
        </div>
      );
    case "horizontal-rule":
      return <div className="markdown-wysiwyg-hr" role="separator" />;
    case "source":
      return (
        <textarea
          className={`markdown-wysiwyg-source-island is-${block.reason}`}
          value={block.source}
          disabled={disabled}
          aria-label={`${block.reason} source island`}
          spellCheck={false}
          onChange={(event) =>
            onChange({ ...block, source: event.currentTarget.value })
          }
        />
      );
  }
}
