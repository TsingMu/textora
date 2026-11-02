import {
  collectMarkdownMermaidBlocks,
  renderMarkdownPreview,
  type MarkdownMermaidBlockPreview,
} from "./markdownPreview";
import { renderMermaidPreview } from "./mermaidPreview";

/** One immutable render shared by PDF and Word, independent of the visible mode. */
export async function prepareMarkdownExport(source: string): Promise<string> {
  const blocks: Record<number, MarkdownMermaidBlockPreview> = {};
  const diagrams = collectMarkdownMermaidBlocks(source);
  for (let index = 0; index < diagrams.length; index += 1) {
    const result = await renderMermaidPreview(diagrams[index]);
    if (result.status !== "ok")
      throw new Error(
        "A Mermaid diagram could not be rendered. Correct it before exporting.",
      );
    blocks[index] = result;
  }
  const result = renderMarkdownPreview(source, { mermaidBlocks: blocks });
  if (result.status !== "ok")
    throw new Error("The Markdown preview could not be rendered.");
  return result.html;
}

export function markdownExportFileName(
  displayName: string,
  extension: "pdf" | "docx",
): string {
  const name =
    displayName
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\u0000-\u001f]/g, "")
      .replace(/\.(md|markdown)$/i, "") || "Document";
  return `${name}.${extension}`;
}

/** Keep this snapshot mounted until native printing has finished. */
export async function mountMarkdownPrintSnapshot(
  html: string,
  title: string,
): Promise<() => void> {
  if (document.getElementById("markdown-export-root"))
    throw new Error("Another export is already running.");
  const root = document.createElement("article");
  root.id = "markdown-export-root";
  root.className = "markdown-preview-content";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = html; // Only safe output from prepareMarkdownExport.
  const oldTitle = document.title;
  document.title = title;
  document.body.append(root);
  const cleanup = () => {
    root.remove();
    document.title = oldTitle;
  };
  try {
    await document.fonts?.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
