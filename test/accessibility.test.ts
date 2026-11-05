// Accessible documents: the Markdown parser, docx_write and pdf_write defaults, and a11y_check.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { deflateSync } from "node:zlib";
import { test } from "node:test";
import { auditFolder, checkDocx, checkFile, checkHtml, checkPdf, contrastOnWhite, findDocuments } from "../src/catatui/a11y.ts";
import { registerDocumentTools } from "../src/catatui/documents.ts";
import { parseMarkdown } from "../src/catatui/markdown.ts";
import { registerPdfWrite, writePdf } from "../src/catatui/pdfwrite.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "catatui-a11y-")));

// A small solid PNG, made here so the test needs no image file.
function png(w: number, h: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => {
    const body = Buffer.concat([Buffer.from(t), d]);
    const out = Buffer.alloc(4 + body.length);
    out.writeUInt32BE(d.length, 0);
    body.copy(out, 4);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([out, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const MD = `# Report

Some **bold** text and a [link to MSU](https://www.montana.edu).

## Data

- one
- two

1. first
2. second

| Name | Score |
| --- | --- |
| Ann | 90 |

![A gray box](box.png)

\`\`\`
x = 1
\`\`\`
`;

test("parseMarkdown: blocks, runs, lists, tables, images, and code", () => {
  const b = parseMarkdown(MD);
  assert.deepEqual(b.map((x) => x.type), ["heading", "paragraph", "heading", "list", "list", "table", "image", "code"]);
  const p = b[1] as any;
  assert.deepEqual(p.runs.filter((r: any) => r.bold || r.link).map((r: any) => [r.text, r.bold ?? false, r.link]), [["bold", true, undefined], ["link to MSU", false, "https://www.montana.edu"]]);
  assert.deepEqual([(b[3] as any).ordered, (b[4] as any).ordered], [false, true]);
  assert.equal((b[5] as any).rows.length, 2);
  assert.deepEqual([(b[6] as any).alt, (b[6] as any).path], ["A gray box", "box.png"]);
  assert.equal((b[7] as any).text, "x = 1");
});

async function writeWith(tool: string, cwd: string, params: Record<string, unknown>) {
  const { pi, tools } = fakePi();
  registerDocumentTools(pi);
  registerPdfWrite(pi);
  return tools.get(tool).execute("id", params, undefined, undefined, fakeCtx(cwd).ctx);
}

test("the writers refuse an image with no alt text or outside the project, and warn about skipped headings", async () => {
  const cwd = dir();
  writeFileSync(join(cwd, "box.png"), png(10, 10));
  for (const tool of ["docx_write", "pdf_write"]) {
    const ext = tool === "pdf_write" ? "pdf" : "docx";
    await assert.rejects(writeWith(tool, cwd, { path: `a.${ext}`, title: "T", markdown: "# T\n\n![](box.png)" }), /has no alt text/);
    await assert.rejects(writeWith(tool, cwd, { path: `a.${ext}`, title: "T", markdown: "# T\n\n![x](../box.png)" }), /not in the project folder/);
    const r = await writeWith(tool, cwd, { path: `a.${ext}`, title: "T", markdown: "# T\n\n### Deep\n\n[click here](https://x.org)" });
    assert.match(r.content[0].text, /level 3 after level 1/);
    assert.match(r.content[0].text, /"click here" does not say where/);
  }
});

test("pdf_write: a tagged PDF/UA file with title, language, headings, list, table header cells, and figure alt text", async () => {
  const cwd = dir();
  writeFileSync(join(cwd, "box.png"), png(40, 20));
  await writeWith("pdf_write", cwd, { path: "out/r.pdf", title: "Report", markdown: MD, lang: "en-US" });
  const data = new Uint8Array(readFileSync(join(cwd, "out/r.pdf")));
  const report = await checkPdf(data);
  assert.deepEqual(report.findings, []);
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const roles: string[] = [];
  const walk = (n: any) => { if (n.role) roles.push(n.role); (n.children ?? []).forEach(walk); };
  walk(await (await pdf.getPage(1)).getStructTree());
  for (const r of ["Document", "H1", "H2", "P", "L", "LI", "Table", "TR", "TH", "TD", "Figure"]) assert.ok(roles.includes(r), r);
  assert.match(readFileSync(join(cwd, "out/r.pdf"), "latin1"), /pdfuaid:part/);
});

test("pdf_write: a long document keeps tags on every page", async () => {
  const para = "This is a long paragraph of text that wraps on the page. ".repeat(12);
  const rows = Array.from({ length: 60 }, (_, i) => `| row ${i} | ${i * 2} |`).join("\n");
  const md = `# Long\n\n${Array(20).fill(para).join("\n\n")}\n\n## Table\n\n| A | B |\n| --- | --- |\n${rows}`;
  const { data } = await writePdf(dir(), "Long", md);
  const report = await checkPdf(new Uint8Array(data));
  assert.ok(Number(/^(\d+) pages/.exec(report.summary)?.[1]) >= 3, report.summary);
  assert.deepEqual(report.findings, []);
  assert.match(report.passed.join(";"), /structure on (\d+) of \1 pages/);
});

test("pdf_write: a list item that continues on a new page keeps its tags", async () => {
  const item = "A list item with enough words to wrap over more than one line on the page. ".repeat(3);
  const md = `# List\n\n${Array.from({ length: 30 }, () => `- ${item}`).join("\n")}`;
  const { data } = await writePdf(dir(), "List", md);
  const report = await checkPdf(new Uint8Array(data));
  assert.deepEqual(report.findings, []);
  assert.match(report.passed.join(";"), /structure on ([2-9]) of \1 pages/);
});

test("a11y_check finds the problems of an untagged PDF", async () => {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise((ok) => doc.on("end", ok));
  doc.fontSize(20).text("Heading").fontSize(11).text("Body text.");
  doc.end();
  await done;
  const text = (await checkPdf(new Uint8Array(Buffer.concat(chunks)))).findings.map((f) => `${f.level}: ${f.text}`).join("\n");
  assert.match(text, /error: The PDF has no title/);
  assert.match(text, /error: The PDF has no language/);
  assert.match(text, /error: The PDF is not tagged/);
  assert.match(text, /error: 1 fonts are not embedded/);
});

test("a11y_check: a scanned PDF (no text) is an error", async () => {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ info: { Title: "Scan" }, lang: "en-US" });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise((ok) => doc.on("end", ok));
  doc.image(png(50, 50), 72, 72);
  doc.end();
  await done;
  const r = await checkPdf(new Uint8Array(Buffer.concat(chunks)));
  assert.ok(r.findings.some((f) => /no text. It can be scanned/.test(f.text)));
});

test("docx_write: title, language, real lists, header row, alt text; a11y_check passes", async () => {
  const cwd = dir();
  writeFileSync(join(cwd, "box.png"), png(40, 20));
  await writeWith("docx_write", cwd, { path: "r.docx", title: "Report", markdown: MD, lang: "es-MX" });
  const data = readFileSync(join(cwd, "r.docx"));
  const report = await checkDocx(data);
  assert.deepEqual(report.findings, []);
  assert.match(report.passed.join(";"), /language es-MX/);
  const JSZip = (await import("jszip")).default;
  const xml = await (await JSZip.loadAsync(data)).file("word/document.xml")!.async("string");
  assert.equal((xml.match(/<w:numPr>/g) ?? []).length, 4);
  assert.match(xml, /descr="A gray box"/);
});

test("a11y_check finds the problems of a poor Word file", async () => {
  const d = await import("docx");
  const doc = new d.Document({
    sections: [{
      children: [
        new d.Paragraph({ children: [new d.TextRun({ text: "Fake heading", bold: true })] }),
        new d.Paragraph({ children: [new d.TextRun({ text: "Light text", color: "BBBBBB" })] }),
        new d.Paragraph({ children: [new d.TextRun("• typed bullet")] }),
        new d.Paragraph({ children: [new d.ExternalHyperlink({ link: "https://x.org", children: [new d.TextRun("click here")] })] }),
        new d.Paragraph({ children: [new d.ImageRun({ type: "png", data: png(10, 10), transformation: { width: 10, height: 10 } })] }),
        new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph("a")] })] })] }),
        new d.Paragraph(""), new d.Paragraph(""), new d.Paragraph(""),
      ],
    }],
  });
  const r = await checkDocx(await d.Packer.toBuffer(doc));
  const text = r.findings.map((f) => `${f.level}: ${f.text}`).join("\n");
  assert.match(text, /error: The document has no title/);
  assert.match(text, /warning: The document has no headings/);
  assert.match(text, /look like headings but are not: "Fake heading"/);
  assert.match(text, /look like typed list items/);
  assert.match(text, /links do not say where they go: "click here"/);
  assert.match(text, /error: 1 images have no alt text/);
  assert.match(text, /1 of 1 tables have no header row/);
  assert.match(text, /low contrast on white: "#BBBBBB/);
  assert.match(text, /empty paragraphs for space/);
});

test("a11y_check: HTML", () => {
  const bad = checkHtml(`<html><body><h1>A</h1><h3>B</h3><img src="x.png"><a href="/y">here</a><input name="q"><table><tr><td>1</td></tr></table></body></html>`);
  const text = bad.findings.map((f) => f.text).join("\n");
  for (const re of [/no lang attribute/, /no <title>/, /images have no alt/, /skip a level/, /"here"/, /form fields have no label: "q"/, /no <th> cells/]) assert.match(text, re);
  const good = checkHtml(`<html lang="en"><head><title>T</title></head><body><h1>A</h1><h2>B</h2><img src="x.png" alt=""><a href="/y">The syllabus</a><label for="q">Search</label><input id="q"><table><tr><th>N</th></tr></table></body></html>`);
  assert.deepEqual(good.findings, []);
});

test("contrastOnWhite: WCAG values", () => {
  assert.equal(Math.round(contrastOnWhite("000000")), 21);
  assert.ok(contrastOnWhite("767676") >= 4.5 && contrastOnWhite("777777") < 4.5);
});

test("a11y_check refuses other file types", async () => {
  const cwd = dir();
  writeFileSync(join(cwd, "a.txt"), "x");
  await assert.rejects(checkFile(join(cwd, "a.txt")), /checks .pdf, .docx, .html/);
});

test("a11y_check: a folder audit checks the documents in subfolders, not hidden folders", async () => {
  const d = dir();
  mkdirSync(join(d, "sub"));
  mkdirSync(join(d, ".git"));
  writeFileSync(join(d, "good.html"), '<html lang="en"><head><title>Good</title></head><body><h1>Good</h1></body></html>');
  writeFileSync(join(d, "sub", "bad.htm"), "<html><body><img src=a.png></body></html>");
  writeFileSync(join(d, "sub", "broken.pdf"), "not a pdf");
  writeFileSync(join(d, ".git", "hidden.html"), "<html></html>");
  writeFileSync(join(d, "notes.txt"), "text");
  writeFileSync(join(d, "~$lock.docx"), "lock");
  assert.deepEqual(findDocuments(d).map((p) => relative(d, p)), ["good.html", join("sub", "bad.htm"), join("sub", "broken.pdf")]);
  const audit = await auditFolder(d, d);
  assert.equal(audit.files.length, 3);
  assert.equal(audit.files.find((f) => f.path === "good.html")?.findings.length, 0);
  assert.ok(audit.files.find((f) => f.path === join("sub", "bad.htm"))!.findings.some((f) => f.level === "error"));
  assert.ok(audit.files.find((f) => f.path === join("sub", "broken.pdf"))?.error);
  assert.match(audit.text, /3 documents\. 1 with errors, 0 with warnings only, 1 with no problems, 1 not checked\./);
});
