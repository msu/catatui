// "pdf_read", "docx_read", and "docx_write" tools: the model can read PDF files and read and write Word files with no Python.
// The read tool cannot use these binary files. docx_write is a file change (CHANGE_TOOLS in config.ts).
// See src/md/features/documents.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Paragraph as DocxParagraph, Table as DocxTable, TextRun as DocxTextRun } from "docx";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";

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

const fullPath = (cwd: string, path: string) => resolve(cwd, path.replace(/^@/, ""));

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

// ---- docx_write ----

const DOCX_WRITE_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .docx file. The tool replaces the file if it exists." }),
  markdown: Type.String({
    description:
      "The document as simple Markdown: # to ### headings, paragraphs (blank line between), - bullets, 1. numbered items, " +
      "| a | b | tables (first row is the header), **bold**, and *italic*.",
  }),
});

// **bold** and *italic* runs in one line of text.
function runs(d: Docx, text: string): DocxTextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("**") && part.endsWith("**")) return new d.TextRun({ text: part.slice(2, -2), bold: true });
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return new d.TextRun({ text: part.slice(1, -1), italics: true });
      return new d.TextRun(part);
    });
}

function table(d: Docx, lines: string[]): DocxTable {
  const rows = lines
    .filter((l) => !/^\|\s*:?-{2,}/.test(l)) // the |---|---| line
    .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  return new d.Table({
    width: { size: 100, type: d.WidthType.PERCENTAGE },
    rows: rows.map((cells, i) => new d.TableRow({
      tableHeader: i === 0,
      children: cells.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: i === 0 ? [new d.TextRun({ text: c, bold: true })] : runs(d, c) })] })),
    })),
  });
}

function markdownToDocx(d: Docx, markdown: string): (DocxParagraph | DocxTable)[] {
  const headings = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3];
  const out: (DocxParagraph | DocxTable)[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(new d.Paragraph({ children: runs(d, para.join(" ")), spacing: { after: 160 } }));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { flush(); out.push(new d.Paragraph({ heading: headings[h[1].length - 1], children: runs(d, h[2]) })); continue; }
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (b) { flush(); out.push(new d.Paragraph({ bullet: { level: 0 }, children: runs(d, b[1]) })); continue; }
    // Numbered items keep their number as text, so no numbering setup is necessary.
    const n = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (n) { flush(); out.push(new d.Paragraph({ indent: { left: 360, hanging: 360 }, children: [new d.TextRun(`${n[1]}.\t`), ...runs(d, n[2])] })); continue; }
    if (line.trim().startsWith("|")) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      i--;
      out.push(table(d, rows), new d.Paragraph({ children: [] }));
      continue;
    }
    if (line.trim() === "") { flush(); continue; }
    para.push(line.trim());
  }
  flush();
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
      "Write a Word .docx file from simple Markdown. Replaces the file if it exists. To change a document, read it with docx_read, then write all of it again. " +
      "Images, comments, tracked changes, and other formatting in the old file are lost.",
    promptSnippet: "Write Word .docx files from Markdown (use this, not Python)",
    parameters: DOCX_WRITE_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const d = await loadDocx();
      const doc = new d.Document({ sections: [{ children: markdownToDocx(d, params.markdown) }] });
      const path = fullPath(ctx.cwd, params.path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, await d.Packer.toBuffer(doc));
      return { content: [{ type: "text", text: `Wrote ${params.path}` }], details: {} };
    },
  });
}

