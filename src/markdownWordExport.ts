import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IRunOptions,
  type IParagraphOptions,
  type INumberingOptions,
} from "docx";

export type ExportImage = { data: Uint8Array; width: number; height: number };

/** Rasterize only a locally sanitized Mermaid SVG; never resolve user images. */
export async function rasterizeExportSvg(svg: Element): Promise<ExportImage> {
  const viewBox = (svg.getAttribute("viewBox") ?? "0 0 640 360")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = viewBox[2] || 640;
  const height = viewBox[3] || 360;
  if (![width, height].every((n) => Number.isFinite(n) && n > 0))
    throw new Error("Invalid diagram dimensions.");
  const scale = Math.min(1, 680 / width, 800 / height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const clone = svg.cloneNode(true) as Element;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w * 2));
  clone.setAttribute("height", String(h * 2));
  clone.removeAttribute("style");
  const xml = new XMLSerializer().serializeToString(clone);
  const bytes = new TextEncoder().encode(xml);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Diagram export timed out.")),
      15000,
    );
    image.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("A diagram could not be embedded in Word."));
    };
  });
  image.src = `data:image/svg+xml;base64,${btoa(binary)}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = w * 2;
  canvas.height = h * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Diagram export is unavailable.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const png = atob(canvas.toDataURL("image/png").split(",")[1]);
  return {
    data: Uint8Array.from(png, (ch) => ch.charCodeAt(0)),
    width: w,
    height: h,
  };
}

const font = {
  ascii: "Arial",
  hAnsi: "Arial",
  eastAsia: "PingFang SC",
  cs: "Arial",
};
const monoFont = { ...font, ascii: "Menlo", hAnsi: "Menlo" };
const colors: Record<string, string> = {
  "tok-keyword": "FFB86C",
  "tok-atom": "F1FA8C",
  "tok-bool": "F1FA8C",
  "tok-number": "F1FA8C",
  "tok-string": "A7E3A1",
  "tok-inserted": "A7E3A1",
  "tok-comment": "9A9288",
  "tok-variableName": "8FD3FF",
  "tok-definition": "8FD3FF",
  "tok-propertyName": "8FD3FF",
  "tok-typeName": "8FD3FF",
  "tok-labelName": "8FD3FF",
  "tok-function": "FFD27D",
  "tok-className": "FFD27D",
  "tok-operator": "D8D1C8",
  "tok-punctuation": "D8D1C8",
  "tok-meta": "D8D1C8",
  "tok-invalid": "FF9B91",
};
function inline(nodes: Iterable<Node>, inherited: IRunOptions = {}): TextRun[] {
  const result: TextRun[] = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      const lines = (node.textContent ?? "").split("\n");
      lines.forEach((text, i) => {
        if (i) result.push(new TextRun({ ...inherited, break: 1 }));
        if (text) result.push(new TextRun({ ...inherited, text }));
      });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (["script", "style", "svg", "ul", "ol"].includes(tag)) continue;
    if (tag === "br") {
      result.push(new TextRun({ ...inherited, break: 1 }));
      continue;
    }
    if (tag === "input") {
      result.push(
        new TextRun({
          ...inherited,
          text: element.hasAttribute("checked") ? "☑ " : "☐ ",
        }),
      );
      continue;
    }
    let style: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {
      ...inherited,
    };
    if (tag === "strong" || tag === "b") style.bold = true;
    if (tag === "em" || tag === "i") style.italics = true;
    if (["del", "s", "strike"].includes(tag)) style.strike = true;
    if (tag === "code")
      style = {
        ...style,
        font: monoFont,
        size: 19,
        shading:
          inherited.color === "FFF8EF"
            ? undefined
            : { fill: "F1EBE2", type: ShadingType.CLEAR },
      };
    if (element.classList.contains("markdown-preview-link"))
      style.color = "B95732";
    if (element.classList.contains("markdown-preview-link-url"))
      style = { ...style, color: "777065", size: 19 };
    for (const className of element.classList)
      if (colors[className]) style.color = colors[className];
    result.push(...inline(element.childNodes, style));
  }
  return result;
}

/** Consume the safe rendered Preview, not an arbitrary user HTML document. */
export async function buildMarkdownDocx(
  html: string,
  title: string,
  rasterize = rasterizeExportSvg,
): Promise<Uint8Array> {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const numbering: INumberingOptions["config"][number][] = [];
  const headings = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  const paragraph = (element: Element, options: IParagraphOptions = {}) =>
    new Paragraph({ children: inline(element.childNodes), ...options });
  async function blocks(
    parent: Element,
    depth = 0,
  ): Promise<(Paragraph | Table)[]> {
    const output: (Paragraph | Table)[] = [];
    for (const node of parent.childNodes) {
      if (node.nodeType === 3) {
        if (node.textContent?.trim())
          output.push(
            new Paragraph({ children: [new TextRun(node.textContent)] }),
          );
        continue;
      }
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        output.push(
          paragraph(el, {
            heading: headings[Number(tag[1]) - 1],
            keepNext: true,
          }),
        );
      } else if (tag === "p") {
        output.push(paragraph(el));
      } else if (tag === "pre") {
        const none = { style: BorderStyle.NONE, size: 0, color: "27231F" };
        output.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            columnWidths: [10466],
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: inline(el.childNodes, {
                          color: "FFF8EF",
                          font: monoFont,
                          size: 19,
                        }),
                        spacing: { before: 0, after: 0, line: 300 },
                      }),
                    ],
                    margins: { top: 180, bottom: 180, left: 180, right: 180 },
                    shading: { fill: "27231F", type: ShadingType.CLEAR },
                    borders: {
                      top: none,
                      bottom: none,
                      left: none,
                      right: none,
                    },
                  }),
                ],
              }),
            ],
          }),
        );
        output.push(
          new Paragraph({
            spacing: { after: 140, before: 0 },
            run: { size: 1 },
          }),
        );
      } else if (tag === "blockquote") {
        const quotes = Array.from(el.querySelectorAll("p"));
        for (const quote of quotes.length ? quotes : [el]) {
          output.push(
            paragraph(quote, {
              children: inline(quote.childNodes, { color: "655B50" }),
              indent: { left: 240 },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  size: 12,
                  color: "D8C8B8",
                  space: 6,
                },
              },
            }),
          );
        }
      } else if (tag === "ul" || tag === "ol") {
        const reference = `list-${numbering.length}`;
        numbering.push({
          reference,
          levels: [
            {
              level: 0,
              format: tag === "ol" ? LevelFormat.DECIMAL : LevelFormat.BULLET,
              text: tag === "ol" ? "%1." : "•",
              start: Number(el.getAttribute("start")) || 1,
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 360 * (depth + 1), hanging: 240 },
                },
              },
            },
          ],
        });
        for (const li of el.children) {
          if (li.tagName.toLowerCase() !== "li") continue;
          output.push(
            paragraph(li, {
              numbering: { reference, level: 0 },
              spacing: { before: 0, after: 0 },
            }),
          );
          for (const nested of li.children)
            if (["ul", "ol"].includes(nested.tagName.toLowerCase())) {
              const wrapper = dom.createElement("div");
              wrapper.append(nested.cloneNode(true));
              output.push(...(await blocks(wrapper, depth + 1)));
            }
        }
      } else if (tag === "table") {
        const rows = Array.from(el.querySelectorAll("tr"));
        const columns = Math.max(1, ...rows.map((row) => row.children.length));
        const border = { style: BorderStyle.SINGLE, size: 4, color: "E1D9CF" };
        output.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            columnWidths: Array.from({ length: columns }, () =>
              Math.floor(10466 / columns),
            ),
            rows: rows.map(
              (row) =>
                new TableRow({
                  tableHeader:
                    row.parentElement?.tagName.toLowerCase() === "thead",
                  children: Array.from({ length: columns }, (_, i) => {
                    const cell = row.children[i];
                    const isHeader = cell?.tagName.toLowerCase() === "th";
                    const align =
                      cell?.getAttribute("align") ??
                      (cell as HTMLElement | undefined)?.style.textAlign;
                    return new TableCell({
                      children: [
                        cell
                          ? paragraph(cell, {
                              children: inline(cell.childNodes, {
                                bold: isHeader,
                              }),
                              alignment:
                                align === "center"
                                  ? AlignmentType.CENTER
                                  : align === "right"
                                    ? AlignmentType.RIGHT
                                    : AlignmentType.LEFT,
                              spacing: { after: 0, before: 0 },
                            })
                          : new Paragraph(""),
                      ],
                      margins: { top: 80, bottom: 80, left: 120, right: 120 },
                      borders: {
                        top: border,
                        bottom: border,
                        left: border,
                        right: border,
                      },
                      shading: isHeader
                        ? { fill: "F5EFE6", type: ShadingType.CLEAR }
                        : undefined,
                    });
                  }),
                }),
            ),
          }),
        );
        output.push(new Paragraph({ spacing: { after: 100 } }));
      } else if (tag === "hr") {
        output.push(
          new Paragraph({
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: "D8C8B8" },
            },
          }),
        );
      } else if (tag === "svg") {
        const image = await rasterize(el);
        output.push(
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: image.data,
                transformation: { width: image.width, height: image.height },
                altText: {
                  title: "Mermaid diagram",
                  description:
                    Array.from(el.querySelectorAll("text"))
                      .map((text) => text.textContent ?? "")
                      .join(" ")
                      .slice(0, 1000) || "Mermaid diagram",
                  name: "Mermaid diagram",
                },
              }),
            ],
            alignment: AlignmentType.CENTER,
          }),
        );
      } else if (!["script", "style", "img"].includes(tag)) {
        output.push(...(await blocks(el, depth)));
      }
    }
    return output;
  }
  const children = await blocks(dom.body);
  const [heading1, heading2, heading3, heading4, heading5, heading6] =
    headings.map((_, i) => ({
      basedOn: "Normal",
      next: "Normal",
      run: {
        font,
        size: [42, 32, 26, 23, 21, 21][i],
        bold: true,
        color: "2D2924",
      },
      paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
    }));
  const file = new Document({
    title,
    creator: "Textora",
    description: "Markdown Preview export",
    styles: {
      default: {
        document: {
          run: { font, size: 21, color: "2D2924" },
          paragraph: { spacing: { after: 200, line: 389 } },
        },
        heading1,
        heading2,
        heading3,
        heading4,
        heading5,
        heading6,
      },
    },
    numbering: { config: numbering },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: children.length ? children : [new Paragraph("")],
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(file));
}
