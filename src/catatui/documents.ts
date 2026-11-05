// "pdf_read", "docx_read", and "docx_write" tools: the model can read PDF files and read and write Word files with no Python.
// The read tool cannot use these binary files. docx_write is a file change (CHANGE_TOOLS in config.ts).
// See src/md/features/documents.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExternalHyperlink, Paragraph as DocxParagraph, Table as DocxTable, TextRun as DocxTextRun } from "docx";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { Type } from "typebox";
import { type Block, parseMarkdown, type Run, structureErrors, structureWarnings } from "./markdown.ts";

type DocxRun = DocxTextRun | ExternalHyperlink;
export const DEFAULT_LANG = "en-US";

// The libraries load when a tool runs first, not at catatui start. This keeps the start fast.
type Docx = typeof import("docx");

// docx reads globalThis.localStorage when it loads. Node 25 then prints a warning about --localstorage-file
// on stderr, which breaks the screen. Hide only this warning while docx loads.
async function loadDocx(): Promise<Docx> {
  const emit = process.emitWarning;
  process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
    if (String(w).includes("--localstorage-file")) return;
    return (emit as (...a: unknown[]) => void).call(process, w, ...rest);
  }) as typeof process.emitWarning;
  try {
    return await import("docx");
  } finally {
    process.emitWarning = emit;
  }
}

const MAX_CHARS = 50_000;

export const fullPath = (cwd: string, path: string) => resolve(cwd, path.replace(/^@/, ""));

function cut(text: string, hint: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[Output cut at ${MAX_CHARS} characters. ${hint}]` : text;
}

// ---- pdf_read ----

const PDF_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .pdf file" }),
  first: Type.Optional(Type.Number({ description: "First page to read (1 is the first page). Default: 1" })),
  last: Type.Optional(Type.Number({ description: "Last page to read. Default: the last page" })),
});

// ---- docx_read ----

const DOCX_READ_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .docx file" }),
});

// Markdown from mammoth's HTML: headings, lists, tables, bold, and italic. Other markup becomes plain text.
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_m, body: string) => {
      const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, tr]) =>
        `| ${[...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(([, td]) => td.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).join(" | ")} |`);
      if (rows.length) rows.splice(1, 0, `|${" --- |".repeat(rows[0].split(" | ").length)}`);
      return `\n\n${rows.join("\n")}\n\n`;
    })
    .replace(/<h([1-6])[^>]*>/g, (_m, n) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/g, "\n\n")
    .replace(/<li[^>]*>/g, "\n- ")
    .replace(/<\/(ul|ol)>/g, "\n\n")
    .replace(/<\/?(strong|b)>/g, "**")
    .replace(/<\/?(em|i)>/g, "*")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- docx_write and pdf_write ----

export const WRITE_MARKDOWN =
  "The document as simple Markdown: # to ###### headings (start with one #, do not skip levels), paragraphs (blank line between), " +
  "- bullets, 1. numbered items, | a | b | tables (first row is the header), **bold**, *italic*, `code`, ``` code blocks, " +
  "[link text](url) (the text names the target, not \"click here\"), and ![alt text](image.png) on its own line " +
  "(PNG or JPEG in the project; the alt text says what the image shows).";

export const WRITE_PARAMS = (ext: string) => Type.Object({
  path: Type.String({ description: `Path to the ${ext} file. The tool replaces the file if it exists.` }),
  title: Type.String({ description: "The document title. Screen readers and the window title show it." }),
  markdown: Type.String({ description: WRITE_MARKDOWN }),
  lang: Type.Optional(Type.String({ description: "The language of the document, for example en-US or es-MX. Default: en-US" })),
});

// An image in the Markdown: the file must be in the project, and it must be PNG or JPEG.
export function loadImage(cwd: string, path: string): { data: Buffer; type: "png" | "jpg"; width: number; height: number } {
  const full = fullPath(cwd, path);
  const rel = relative(resolve(cwd), full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`The image ${path} is not in the project folder. Copy it into the project first.`);
  const data = readFileSync(full);
  if (data.subarray(1, 4).toString("latin1") === "PNG") return { data, type: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data[0] === 0xff && data[1] === 0xd8) {
    // The size is in the first SOFn segment.
    for (let i = 2; i + 9 < data.length;) {
      if (data[i] !== 0xff) break;
      const marker = data[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { data, type: "jpg", height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
      }
      i += 2 + data.readUInt16BE(i + 2);
    }
  }
  throw new Error(`The image ${path} is not a PNG or JPEG file. Convert it to PNG first.`);
}

export function checkStructure(blocks: Block[]): string[] {
  const errors = structureErrors(blocks);
  if (errors.length) throw new Error(`The document is not accessible, so the tool did not write it:\n- ${errors.join("\n- ")}`);
  return structureWarnings(blocks);
}

export const wroteText = (path: string, warnings: string[]) =>
  `Wrote ${path}${warnings.length ? `\nAccessibility warnings (fix them, then write the file again):\n- ${warnings.join("\n- ")}` : ""}`;

function docxRuns(d: Docx, runs: Run[]): DocxRun[] {
  return runs.map((r) => {
    const run = new d.TextRun({ text: r.text, bold: r.bold, italics: r.italic, font: r.code ? "Consolas" : undefined, style: r.link ? "Hyperlink" : undefined });
    return r.link ? new d.ExternalHyperlink({ link: r.link, children: [run] }) : run;
  });
}

const HEADINGS = ["HEADING_1", "HEADING_2", "HEADING_3", "HEADING_4", "HEADING_5", "HEADING_6"] as const;
// Width of the text on a Letter page with 1 inch margins, in pixels at 96 to the inch.
const DOCX_TEXT_WIDTH = 624;

function blocksToDocx(d: Docx, blocks: Block[], cwd: string): (DocxParagraph | DocxTable)[] {
  const out: (DocxParagraph | DocxTable)[] = [];
  let lists = 0;
  for (const b of blocks) {
    if (b.type === "heading") out.push(new d.Paragraph({ heading: d.HeadingLevel[HEADINGS[b.level - 1]], children: docxRuns(d, b.runs) }));
    else if (b.type === "paragraph") out.push(new d.Paragraph({ children: docxRuns(d, b.runs), spacing: { after: 160 } }));
    else if (b.type === "list") {
      // Word lists, not typed bullets or numbers: screen readers say "list, 3 items". A new instance starts at 1.
      const instance = ++lists;
      for (const item of b.items) {
        out.push(new d.Paragraph({
          children: docxRuns(d, item),
          ...(b.ordered ? { numbering: { reference: "numbers", level: 0, instance } } : { bullet: { level: 0 } }),
        }));
      }
      out.push(new d.Paragraph({ children: [], spacing: { after: 80 } }));
    } else if (b.type === "table") {
      out.push(new d.Table({
        width: { size: 100, type: d.WidthType.PERCENTAGE },
        rows: b.rows.map((cells, i) => new d.TableRow({
          // The first row repeats on each page, and Word marks it as the header row for screen readers.
          tableHeader: i === 0,
          children: cells.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: docxRuns(d, i === 0 ? c.map((r) => ({ ...r, bold: true })) : c) })] })),
        })),
      }), new d.Paragraph({ children: [] }));
    } else if (b.type === "image") {
      const img = loadImage(cwd, b.path);
      const scale = Math.min(1, DOCX_TEXT_WIDTH / img.width);
      out.push(new d.Paragraph({
        children: [new d.ImageRun({
          type: img.type,
          data: img.data,
          transformation: { width: Math.round(img.width * scale), height: Math.round(img.height * scale) },
          altText: { name: basename(b.path), title: b.alt, description: b.alt },
        })],
        spacing: { after: 160 },
      }));
    } else if (b.type === "code") {
      const lines = b.text.split("\n");
      out.push(new d.Paragraph({
        children: lines.map((l, i) => new d.TextRun({ text: l, font: "Consolas", break: i ? 1 : undefined })),
        spacing: { after: 160 },
      }));
    }
  }
  return out;
}

export function registerDocumentTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pdf_read",
    label: "PDF read",
    description: `Read the text of a PDF file, page by page. Use first and last to read some pages. At most ${MAX_CHARS} characters. A scanned PDF (images only) has no text.`,
    promptSnippet: "Read PDF files (use this, not the read tool or Python)",
    promptGuidelines: ["For .pdf files, use pdf_read. For a long PDF, read some pages with first and last."],
    parameters: PDF_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const data = new Uint8Array(readFileSync(fullPath(ctx.cwd, params.path)));
      const { extractText } = await import("unpdf");
      const { totalPages, text } = await extractText(data, { mergePages: false });
      const first = Math.max(1, Math.floor(params.first ?? 1));
      const last = Math.min(totalPages, Math.floor(params.last ?? totalPages));
      if (first > last) throw new Error(`The PDF has ${totalPages} pages. Use pages 1 to ${totalPages}.`);
      const pages = text.slice(first - 1, last).map((t, i) => `## Page ${first + i}\n${t.trim()}`);
      const body = pages.join("\n\n");
      const empty = body.replace(/## Page \d+/g, "").trim() === "" ? "\n[No text found. The PDF can be scanned images.]" : "";
      const out = cut(`PDF: ${params.path} (${totalPages} pages, showing ${first}-${last})\n\n${body}${empty}`, "Read fewer pages with first and last.");
      return { content: [{ type: "text", text: out }], details: { pages: totalPages } };
    },
  });

  pi.registerTool({
    name: "docx_read",
    label: "Word read",
    description: `Read a Word .docx file as Markdown (headings, lists, tables, bold, italic). Images and comments are not shown. At most ${MAX_CHARS} characters.`,
    promptSnippet: "Read Word .docx files (use this, not the read tool or Python)",
    promptGuidelines: ["For .docx files, use docx_read and docx_write. Do not use read, bash, or Python for them. The student can have no Python."],
    parameters: DOCX_READ_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.convertToHtml({ path: fullPath(ctx.cwd, params.path) });
      const out = cut(htmlToMarkdown(value), "The document is long.");
      return { content: [{ type: "text", text: out || "[The document has no text.]" }], details: {} };
    },
  });

  pi.registerTool({
    name: "docx_write",
    label: "Word write",
    description:
      "Write an accessible Word .docx file from simple Markdown: real headings, lists, table header rows, image alt text, the title, and the language. " +
      "Replaces the file if it exists. To change a document, read it with docx_read, then write all of it again. " +
      "Comments, tracked changes, and other formatting in the old file are lost.",
    promptSnippet: "Write accessible Word .docx files from Markdown (use this, not Python)",
    parameters: WRITE_PARAMS(".docx"),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const blocks = parseMarkdown(params.markdown);
      const warnings = checkStructure(blocks);
      const d = await loadDocx();
      const lang = params.lang || DEFAULT_LANG;
      const doc = new d.Document({
        title: params.title,
        styles: { default: { document: { run: { language: { value: lang } } } } },
        numbering: {
          config: [{
            reference: "numbers",
            levels: [{ level: 0, format: d.LevelFormat.DECIMAL, text: "%1.", alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
          }],
        },
        sections: [{ children: blocksToDocx(d, blocks, ctx.cwd) }],
      });
      const path = fullPath(ctx.cwd, params.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, await d.Packer.toBuffer(doc));
      return { content: [{ type: "text", text: wroteText(params.path, warnings) }], details: { warnings } };
    },
  });
}

