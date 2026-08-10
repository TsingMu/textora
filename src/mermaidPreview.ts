/**
 * Mermaid 本地预览渲染适配层（`docs/features/mermaid-local-preview.md` 切片 3）。
 *
 * 本模块只负责把 Mermaid 源码转换为可显示的安全 SVG/HTML 字符串，供后续 UI
 * 接入；不读取文件、不触发网络、不调用 Tauri/Rust IPC，也不维护组件状态。
 */

export type MermaidPreviewResult =
  | { status: "ok"; html: string }
  | { status: "error"; html: string; message: string };

const MERMAID_ERROR_TITLE = "Mermaid preview unavailable";
type MermaidApi = typeof import("mermaid").default;
let mermaidInitialized = false;
let mermaidApi: MermaidApi | null = null;
let renderSequence = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (mermaidApi !== null) {
    return mermaidApi;
  }
  const module = await import("mermaid");
  mermaidApi = module.default;
  return mermaidApi;
}

async function ensureMermaidInitialized(): Promise<MermaidApi> {
  const mermaid = await loadMermaid();
  if (mermaidInitialized) {
    return mermaid;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    theme: "default",
    logLevel: "error",
    arrowMarkerAbsolute: false,
  });
  mermaidInitialized = true;
  return mermaid;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function errorResult(error: unknown): MermaidPreviewResult {
  const rawMessage =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "The Mermaid source could not be rendered.";
  const message = rawMessage.split("\n").slice(0, 4).join("\n");
  return {
    status: "error",
    message,
    html: `<div class="mermaid-preview-error" role="status"><strong>${MERMAID_ERROR_TITLE}</strong><pre>${escapeHtml(message)}</pre></div>`,
  };
}

function isUnsafeElement(element: Element): boolean {
  return [
    "script",
    "foreignobject",
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
    "canvas",
  ].includes(element.tagName.toLowerCase());
}

function isUnsafeUrlAttribute(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "href" || lower === "xlink:href" || lower === "src";
}

function isSafeLocalReference(value: string): boolean {
  return value.trim().startsWith("#");
}

function styleContainsExternalResource(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    /@import\b/.test(lower) ||
    /expression\s*\(/.test(lower) ||
    /url\s*\(\s*['"]?(?!#)/.test(lower)
  );
}

function sanitizeElement(element: Element) {
  for (const attribute of [...element.attributes]) {
    const name = attribute.name;
    const value = attribute.value;
    const lowerName = name.toLowerCase();

    if (lowerName.startsWith("on")) {
      element.removeAttribute(name);
      continue;
    }

    if (isUnsafeUrlAttribute(lowerName)) {
      if (!isSafeLocalReference(value)) {
        element.removeAttribute(name);
      }
      continue;
    }

    if (lowerName === "style" && styleContainsExternalResource(value)) {
      element.removeAttribute(name);
      continue;
    }

    if (value.toLowerCase().includes("javascript:")) {
      element.removeAttribute(name);
      continue;
    }

    if (/url\s*\(/i.test(value) && !/url\s*\(\s*#/.test(value)) {
      element.removeAttribute(name);
    }
  }

  if (
    element.tagName.toLowerCase() === "style" &&
    styleContainsExternalResource(element.textContent ?? "")
  ) {
    element.remove();
  }
}

/**
 * 清洗 Mermaid 产出的 SVG，去掉脚本、事件属性和外部资源引用。正常 Mermaid
 * 渲染在 `securityLevel: "strict"` 下已经会做一层约束；这里作为 Textora 自己的
 * 防线，避免后续 UI 直接信任第三方库产物。
 */
export function sanitizeMermaidSvgForPreview(svg: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(svg, "image/svg+xml");
  const parseError = document.querySelector("parsererror");
  if (parseError !== null) {
    throw new Error("Mermaid rendered invalid SVG.");
  }

  const root = document.documentElement;
  if (root.tagName.toLowerCase() !== "svg") {
    throw new Error("Mermaid rendered a non-SVG preview.");
  }

  for (const element of [...root.querySelectorAll("*")]) {
    if (isUnsafeElement(element)) {
      element.remove();
      continue;
    }
    sanitizeElement(element);
  }
  sanitizeElement(root);

  return new XMLSerializer().serializeToString(root);
}

/**
 * 本地渲染 Mermaid 源码。成功时返回清洗后的 SVG 字符串；失败时返回可直接显示的
 * 错误占位，调用方不需要 try/catch。
 */
export async function renderMermaidPreview(
  source: string,
): Promise<MermaidPreviewResult> {
  if (typeof document === "undefined" || typeof DOMParser === "undefined") {
    return errorResult(new Error("Mermaid preview requires a browser document."));
  }

  try {
    const mermaid = await ensureMermaidInitialized();
    const id = `textora-mermaid-preview-${++renderSequence}`;
    const container = document.createElement("div");
    container.id = `${id}-container`;
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "-10000px";
    container.style.width = "1px";
    container.style.height = "1px";
    document.body.append(container);
    try {
      const { svg } = await mermaid.render(id, source, container);
      return { status: "ok", html: sanitizeMermaidSvgForPreview(svg) };
    } finally {
      container.remove();
    }
  } catch (error) {
    return errorResult(error);
  }
}
