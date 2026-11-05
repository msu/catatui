// "pdf_write" tool: an accessible PDF (tagged PDF, PDF/UA-1) from the same simple Markdown as docx_write.
// pdfkit writes the structure tree (headings, paragraphs, lists, tables, figures with alt text), the title,
// the language, and bookmarks. The DejaVu fonts are embedded, because PDF/UA does not allow fonts that are not embedded.
// See src/md/features/documents.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { checkStructure, DEFAULT_LANG, fullPath, loadImage, WRITE_PARAMS, wroteText } from "./documents.ts";
import { type Block, parseMarkdown, type Run } from "./markdown.ts";

const require = createRequire(import.meta.url);
const FONT_DIR = dirname(require.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf"));
const FONTS = {
  sans: "DejaVuSans.ttf",
  bold: "DejaVuSans-Bold.ttf",
  italic: "DejaVuSans-Oblique.ttf",
  boldItalic: "DejaVuSans-BoldOblique.ttf",
  mono: "DejaVuSansMono.ttf",
};
const SIZE = { body: 11, code: 9.5, heading: [20, 16, 13.5, 12, 11, 11] };
const MARGIN = 72;
const CELL_PAD = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

// A link shows its address after the text, unless the text is the address.
const runText = (r: Run) => (r.link && !r.link.replace(/^https?:\/\/(www\.)?/, "").startsWith(r.text.replace(/^(www\.)/, "").replace(/\/$/, "")) ? `${r.text} (${r.link})` : r.link ?? r.text);
const fontOf = (r: Run) => (r.code ? "mono" : r.bold && r.italic ? "boldItalic" : r.bold ? "bold" : r.italic ? "italic" : "sans");
// pdfkit: the text of a structure element must end with a space, so that words do not join in a screen reader.
const spaced = (t: string) => (t.endsWith(" ") ? t : `${t} `);

function writeRuns(doc: Doc, runs: Run[], size: number, base: "sans" | "bold" = "sans", width?: number) {
  const list = runs.length ? runs : [{ text: "" }];
  list.forEach((r, i) => {
    const last = i === list.length - 1;
    const font = base === "bold" && fontOf(r) === "sans" ? "bold" : fontOf(r);
    doc.font(font).fontSize(size).text(last ? spaced(runText(r)) : runText(r), { continued: !last, ...(width ? { width } : {}) });
  });
}

const bottom = (doc: Doc) => doc.page.height - doc.page.margins.bottom;
const textWidth = (doc: Doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;

function newPageIfLow(doc: Doc, need: number) {
  if (doc.y + need > bottom(doc)) doc.addPage();
}

function table(doc: Doc, parent: Doc, rows: Run[][][]) {
  const cols = Math.max(...rows.map((r) => r.length));
  const width = textWidth(doc) / cols;
  const left = doc.page.margins.left;
  const t = doc.struct("Table");
  parent.add(t);
  rows.forEach((cells, ri) => {
    const header = ri === 0;
    const font = header ? "bold" : "sans";
    const texts = Array.from({ length: cols }, (_, ci) => spaced((cells[ci] ?? []).map(runText).join("")));
    doc.font(font).fontSize(SIZE.body);
    const height = Math.max(...texts.map((s) => doc.heightOfString(s, { width: width - 2 * CELL_PAD }))) + 2 * CELL_PAD;
    newPageIfLow(doc, height);
    const top = doc.y;
    // The cell borders are not content: mark them as an artifact, so screen readers skip them.
    doc.markContent("Artifact", { type: "Layout" });
    doc.save().lineWidth(0.5).strokeColor("#555555");
    for (let ci = 0; ci < cols; ci++) doc.rect(left + ci * width, top, width, height).stroke();
    doc.restore();
    doc.endMarkedContent();
    const tr = doc.struct("TR");
    t.add(tr);
    texts.forEach((s, ci) => {
      tr.add(doc.struct(header ? "TH" : "TD", header ? { scope: "Column" } : {}, () => {
        doc.font(font).fontSize(SIZE.body).text(s, left + ci * width + CELL_PAD, top + CELL_PAD, { width: width - 2 * CELL_PAD });
      }));
    });
    tr.end();
    doc.x = left;
    doc.y = top + height;
  });
  t.end();
  doc.moveDown(0.8);
}

function blocksToPdf(doc: Doc, root: Doc, blocks: Block[], cwd: string) {
  let outlineTop: Doc;
  for (const b of blocks) {
    doc.x = doc.page.margins.left;
    if (b.type === "heading") {
      const size = SIZE.heading[b.level - 1];
      if (doc.y > doc.page.margins.top + 1) doc.moveDown(0.6);
      // Keep a heading with the text after it.
      newPageIfLow(doc, size * 4);
      // Bookmarks: level 1 and level 2 headings.
      if (b.level === 1 || !outlineTop) outlineTop = doc.outline.addItem(b.text);
      else if (b.level === 2) outlineTop.addItem(b.text);
      root.add(doc.struct(`H${b.level}`, () => writeRuns(doc, b.runs, size, "bold")));
      doc.moveDown(0.3);
    } else if (b.type === "paragraph") {
      root.add(doc.struct("P", () => writeRuns(doc, b.runs, SIZE.body)));
      doc.moveDown(0.6);
    } else if (b.type === "list") {
      // Not doc.list: in pdfkit 0.20.2, a list item that continues on a new page loses its tags there.
      const l = doc.struct("L");
      root.add(l);
      const left = doc.page.margins.left;
      const indent = 18;
      b.items.forEach((item, n) => {
        doc.font("sans").fontSize(SIZE.body);
        newPageIfLow(doc, doc.currentLineHeight(true));
        const top = doc.y;
        const li = doc.struct("LI");
        l.add(li);
        li.add(doc.struct("Lbl", () => doc.text(b.ordered ? `${n + 1}. ` : "• ", left, top, { width: indent, lineBreak: false })));
        li.add(doc.struct("LBody", () => {
          doc.x = left + indent;
          doc.y = top;
          writeRuns(doc, item, SIZE.body, "sans", textWidth(doc) - indent);
        }));
        li.end();
        doc.x = left;
      });
      l.end();
      doc.moveDown(0.6);
    } else if (b.type === "table") {
      table(doc, root, b.rows);
    } else if (b.type === "image") {
      const img = loadImage(cwd, b.path);
      const scale = Math.min(1, textWidth(doc) / img.width, 400 / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      newPageIfLow(doc, h);
      const x = doc.page.margins.left;
      const y = doc.y;
      root.add(doc.struct("Figure", { alt: b.alt, bbox: [x, y, x + w, y + h] }, () => doc.image(img.data, x, y, { width: w, height: h })));
      doc.x = x;
      doc.y = y + h;
      doc.moveDown(0.8);
    } else if (b.type === "code") {
      root.add(doc.struct("P", () => doc.font("mono").fontSize(SIZE.code).text(spaced(b.text))));
      doc.moveDown(0.6);
    }
  }
}

export async function writePdf(cwd: string, title: string, markdown: string, lang = DEFAULT_LANG): Promise<{ data: Buffer; warnings: string[] }> {
  const blocks = parseMarkdown(markdown);
  const warnings = checkStructure(blocks);
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({
    size: "LETTER",
    margin: MARGIN,
    pdfVersion: "1.7",
    lang,
    tagged: true,
    displayTitle: true,
    subset: "PDF/UA",
    font: `${FONT_DIR}/${FONTS.sans}`,
    info: { Title: title, Creator: "catatui" },
  });
  for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, `${FONT_DIR}/${file}`);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((ok, fail) => { doc.on("end", ok); doc.on("error", fail); });
  const root = doc.struct("Document");
  doc.addStructure(root);
  try {
    blocksToPdf(doc, root, blocks, cwd);
  } finally {
    root.end();
    doc.end();
  }
  await done;
  return { data: Buffer.concat(chunks), warnings };
}

export function registerPdfWrite(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pdf_write",
    label: "PDF write",
    description:
      "Write an accessible PDF file (tagged PDF, PDF/UA) from simple Markdown: headings, lists, tables with header cells, " +
      "images with alt text, bookmarks, the title, and the language. Replaces the file if it exists. " +
      "Links show the address after the link text.",
    promptSnippet: "Write accessible PDF files from Markdown (use this, not Python or a print to PDF)",
    promptGuidelines: [
      "For a PDF, use pdf_write. Then run a11y_check on the file and fix the problems that it finds.",
    ],
    parameters: WRITE_PARAMS(".pdf"),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const { data, warnings } = await writePdf(ctx.cwd, params.title, params.markdown, params.lang || DEFAULT_LANG);
      const path = fullPath(ctx.cwd, params.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      return { content: [{ type: "text", text: wroteText(params.path, warnings) }], details: { warnings } };
    },
  });
}
