// "a11y_check" tool: find common accessibility problems in a PDF, Word, or HTML file.
// It finds problems that a program can find. It does not prove that a file conforms to WCAG or PDF/UA.
// See src/md/features/accessibility.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { Type } from "typebox";
import { fullPath } from "./documents.ts";
import { badLinkText } from "./markdown.ts";

export interface Finding { level: "error" | "warning"; text: string }
export interface Report { kind: string; summary: string; findings: Finding[]; passed: string[] }

const MAX_PAGES = 200;
const MAX_LISTED = 5;

// Many findings of one kind become one finding with some examples.
function group(findings: Finding[], level: Finding["level"], what: string, items: string[], fix: string) {
  if (!items.length) return;
  const shown = items.slice(0, MAX_LISTED).map((s) => `"${s}"`).join(", ");
  const more = items.length > MAX_LISTED ? ` and ${items.length - MAX_LISTED} more` : "";
  findings.push({ level, text: `${items.length} ${what}: ${shown}${more}. ${fix}` });
}

function headingOrder(levels: { level: number; text: string }[], findings: Finding[], passed: string[]) {
  if (!levels.length) {
    findings.push({ level: "warning", text: "The document has no headings. Add headings, so that screen reader users can move through it." });
    return;
  }
  const skips: string[] = [];
  let prev = 0;
  for (const h of levels) {
    if (h.level > prev + 1) skips.push(`${h.text.slice(0, 60)} (level ${h.level} after ${prev})`);
    prev = h.level;
  }
  if (skips.length) group(findings, "warning", "headings skip a level", skips, "Do not skip heading levels (for example, level 1 then level 3).");
  else passed.push(`${levels.length} headings in order`);
}

// ---- PDF ----

interface StructNode { role?: string; alt?: string; lang?: string; children?: StructNode[]; type?: string }

export async function checkPdf(data: Uint8Array): Promise<Report> {
  const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
  const { OPS } = await getResolvedPDFJS();
  const raw = Buffer.from(data).toString("latin1");
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const findings: Finding[] = [];
  const passed: string[] = [];
  const get = (m: unknown, k: string) => (m instanceof Map ? m.get(k) : (m as Record<string, unknown> | null)?.[k]);

  const { info } = (await pdf.getMetadata()) as { info: Record<string, unknown> };
  const title = typeof info.Title === "string" ? info.Title.trim() : "";
  if (!title) findings.push({ level: "error", text: "The PDF has no title. Set the document title (Title in the document properties)." });
  else passed.push(`title "${title}"`);
  if (title && get(await pdf.getViewerPreferences(), "DisplayDocTitle") !== true) {
    findings.push({ level: "warning", text: "The window shows the file name, not the title. Set DisplayDocTitle to true (\"Show document title\" in the PDF settings)." });
  }
  const lang = typeof info.Language === "string" ? info.Language : "";
  if (!lang) findings.push({ level: "error", text: "The PDF has no language. Set the document language, so that screen readers use the correct voice." });
  else passed.push(`language ${lang}`);

  const tagged = get(await pdf.getMarkInfo(), "Marked") === true;
  if (!tagged) findings.push({ level: "error", text: "The PDF is not tagged. Screen readers cannot find headings, lists, tables, or the reading order. Make the PDF again with tags (for example with pdf_write)." });

  const pages = Math.min(pdf.numPages, MAX_PAGES);
  let chars = 0;
  let structPages = 0;
  const roles = new Map<string, number>();
  const headings: { level: number; text: string }[] = [];
  const figures: string[] = [];
  const tables: number[] = [];
  const unembedded = new Set<string>();
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const text = await page.getTextContent();
    chars += text.items.reduce((n: number, it: { str?: string }) => n + (it.str?.trim().length ?? 0), 0);
    const tree = (await page.getStructTree()) as StructNode | null;
    if (tree?.children?.length) structPages++;
    const walk = (n: StructNode, inTable: number[] | null) => {
      if (n.role) roles.set(n.role, (roles.get(n.role) ?? 0) + 1);
      const h = n.role && /^H([1-6])$/.exec(n.role);
      if (h) headings.push({ level: Number(h[1]), text: `page ${p}` });
      if (n.role === "Figure" && !n.alt?.trim()) figures.push(`page ${p}`);
      let t = inTable;
      if (n.role === "Table") { t = [0]; tables.push(0); }
      if (n.role === "TH" && inTable) tables[tables.length - 1]++;
      for (const c of n.children ?? []) walk(c, t);
    };
    if (tree) walk(tree, null);
    const ops = await page.getOperatorList();
    ops.fnArray.forEach((fn: number, i: number) => {
      if (fn !== OPS.setFont) return;
      const id = ops.argsArray[i][0];
      try {
        const font = page.commonObjs.get(id) as { name?: string; missingFile?: boolean };
        if (font?.missingFile) unembedded.add(font.name ?? id);
      } catch { /* The font did not load. */ }
    });
  }
  const scope = pdf.numPages > MAX_PAGES ? ` (checked the first ${MAX_PAGES} pages)` : "";

  if (chars === 0) findings.push({ level: "error", text: "The PDF has no text. It can be scanned images. Screen readers cannot read it. Run OCR (text recognition), or make the PDF from the source document." });
  else passed.push("the PDF has text");
  if (tagged && structPages === 0) findings.push({ level: "error", text: "The PDF says that it is tagged, but it has no structure tree. Make the PDF again with tags." });
  if (structPages > 0) {
    passed.push(`tagged (structure on ${structPages} of ${pages} pages)`);
    if (structPages < pages) findings.push({ level: "warning", text: `${pages - structPages} pages have no tags. Their content is not in the reading order.` });
    // A heading of type H (not H1 to H6) has no level. Count it as present.
    if (!headings.length && roles.get("H")) passed.push(`${roles.get("H")} headings (type H)`);
    else headingOrder(headings, findings, passed);
    group(findings, "error", "figures have no alt text", figures, "Add alt text that says what each image shows. If an image is only decoration, mark it as an artifact.");
    if ((roles.get("Figure") ?? 0) > 0 && !figures.length) passed.push(`${roles.get("Figure")} figures with alt text`);
    const noHeader = tables.filter((n) => n === 0).length;
    if (noHeader) findings.push({ level: "error", text: `${noHeader} of ${tables.length} tables have no header cells (TH). Mark the header row, so that screen readers can say the column of each cell.` });
    else if (tables.length) passed.push(`${tables.length} tables with header cells`);
  }
  if (unembedded.size) group(findings, "error", "fonts are not embedded", [...unembedded], "Embed all fonts (PDF/UA requires this). Text in a font that is not embedded can show or read incorrectly.");
  else if (chars) passed.push("all fonts are embedded");
  if (/pdfuaid:part/.test(raw)) passed.push("the PDF says that it conforms to PDF/UA");

  return { kind: "PDF", summary: `${pdf.numPages} pages${scope}`, findings, passed };
}

// ---- Word ----

const attr = (xml: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1];
const wText = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

// Contrast ratio of a text color on white (WCAG 2 formula).
export function contrastOnWhite(hex: string): number {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return 1.05 / (lum + 0.05);
}

export async function checkDocx(data: Buffer): Promise<Report> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const read = async (name: string) => (await zip.file(name)?.async("string")) ?? "";
  const [doc, core, styles, settings] = await Promise.all(["word/document.xml", "docProps/core.xml", "word/styles.xml", "word/settings.xml"].map(read));
  if (!doc) throw new Error("The file has no word/document.xml. It is not a Word .docx file.");
  const findings: Finding[] = [];
  const passed: string[] = [];

  const title = /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1]?.trim();
  if (!title) findings.push({ level: "error", text: "The document has no title. Set it in File > Info > Properties > Title." });
  else passed.push(`title "${title}"`);
  const lang = /<w:docDefaults>[\s\S]*?<w:lang [^>]*w:val="([^"]+)"/.exec(styles)?.[1] ?? attr(/<w:themeFontLang [^>]*>/.exec(settings)?.[0] ?? "", "w:val");
  if (!lang) findings.push({ level: "warning", text: "The document has no default language. Set it in Review > Language." });
  else passed.push(`language ${lang}`);

  // Heading styles: the style id can be in another language, so use the style name ("heading 1").
  const headingStyle = new Map<string, number>();
  for (const m of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const name = /<w:name w:val="([^"]+)"/.exec(m[2])?.[1] ?? "";
    const h = /^heading ([1-9])$/i.exec(name);
    if (h) headingStyle.set(m[1], Number(h[1]));
    else if (/^title$/i.test(name)) headingStyle.set(m[1], 1);
  }
  const body = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (t) => t.replace(/<w:p[ >]/g, "<w:p data-cell "));
  const headings: { level: number; text: string }[] = [];
  const fake: string[] = [];
  const typed: string[] = [];
  let empty = 0;
  let emptyRuns = 0;
  for (const m of body.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>|<w:p(?:\s[^>]*)?\/>/g)) {
    const p = m[1] ?? "";
    const text = wText(p).trim();
    const inCell = m[0].startsWith("<w:p data-cell");
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1];
    const level = (style && headingStyle.get(style)) || Number(/<w:outlineLvl w:val="(\d)"/.exec(p)?.[1] ?? -1) + 1 || 0;
    if (!text && !/<w:drawing|<w:pict/.test(p)) {
      if (!inCell && ++empty === 3) emptyRuns++;
      continue;
    }
    empty = 0;
    if (level > 0) { headings.push({ level, text }); continue; }
    if (inCell) continue;
    const runs = [...p.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].filter((r) => wText(r[1]).trim());
    const allBold = runs.length > 0 && runs.every((r) => /<w:b\/>|<w:b w:val="(1|true|on)"\/>/.test(r[1]));
    if (allBold && text.length <= 80 && !/[.:;,]$/.test(text)) fake.push(text.slice(0, 60));
    if (!/<w:numPr>/.test(p) && /^([••●\-*]|\d+[.)])\s/.test(text)) typed.push(text.slice(0, 40));
  }
  headingOrder(headings, findings, passed);
  group(findings, "warning", "short bold paragraphs look like headings but are not", fake, "Use a Heading style for them, so that screen readers find them.");
  group(findings, "warning", "paragraphs look like typed list items", typed, "Use Word bullets or numbering (Home > Bullets), not typed characters.");
  if (emptyRuns) findings.push({ level: "warning", text: `${emptyRuns} places use 3 or more empty paragraphs for space. Screen readers say "blank" for each. Use paragraph spacing or a page break.` });

  const images = [...doc.matchAll(/<wp:docPr ([^>]*?)\/?>([\s\S]*?<\/wp:docPr>)?/g)];
  const noAlt = images.filter((m) => !attr(m[1], "descr")?.trim() && !/decorative[^>]*val="1"/.test(m[0])).map((m) => attr(m[1], "name") ?? "image");
  group(findings, "error", "images have no alt text", noAlt, "Right-click each image > View Alt Text, and say what it shows. If an image is only decoration, select \"Mark as decorative\".");
  if (images.length && !noAlt.length) passed.push(`${images.length} images with alt text or marked as decorative`);

  const tables = [...doc.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>/g)];
  const noHeader = tables.filter((t) => !/<w:tblHeader(\/>| w:val="(1|true|on)")/.test(/<w:tr[ >][\s\S]*?<\/w:tr>/.exec(t[1])?.[0] ?? "")).length;
  if (noHeader) findings.push({ level: "warning", text: `${noHeader} of ${tables.length} tables have no header row. Select the first row, then Table Properties > Row > "Repeat as header row at the top of each page".` });
  else if (tables.length) passed.push(`${tables.length} tables with a header row`);

  const links = [...doc.matchAll(/<w:hyperlink[^>]*>([\s\S]*?)<\/w:hyperlink>/g)].map((m) => wText(m[1]).trim()).filter(badLinkText);
  group(findings, "warning", "links do not say where they go", links, "Use link text that names the target, not \"click here\" or the address.");

  const low = [...new Set([...doc.matchAll(/<w:color w:val="([0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase()))].filter((c) => contrastOnWhite(c) < 4.5);
  group(findings, "warning", "text colors have low contrast on white", low.map((c) => `#${c} (${contrastOnWhite(c).toFixed(1)}:1)`), "Use colors with a contrast of 4.5:1 or more for normal text.");

  return { kind: "Word", summary: `${headings.length} headings, ${images.length} images, ${tables.length} tables`, findings, passed };
}

// ---- HTML ----

export function checkHtml(html: string): Report {
  const findings: Finding[] = [];
  const passed: string[] = [];
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const lang = attr(/<html\b[^>]*>/i.exec(html)?.[0] ?? "", "lang");
  if (!lang) findings.push({ level: "error", text: "The <html> element has no lang attribute. Add one, for example <html lang=\"en\">." });
  else passed.push(`language ${lang}`);
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  if (!title) findings.push({ level: "error", text: "The page has no <title>. Add a title that says what the page is." });
  else passed.push(`title "${title}"`);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)];
  const noAlt = imgs.filter((m) => !/\salt\s*=/i.test(m[0]) && !/role\s*=\s*["']?presentation/i.test(m[0])).map((m) => attr(m[0], "src") ?? "image");
  group(findings, "error", "images have no alt attribute", noAlt, "Add alt text that says what each image shows. For decoration only, use alt=\"\".");
  if (imgs.length && !noAlt.length) passed.push(`${imgs.length} images with alt`);
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: strip(m[2]) }));
  headingOrder(headings, findings, passed);
  const tables = [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)];
  const noTh = tables.filter((t) => !/<th\b/i.test(t[0])).length;
  if (noTh) findings.push({ level: "warning", text: `${noTh} of ${tables.length} tables have no <th> cells. Use <th> for the header cells. If the table is only for layout, use CSS.` });
  else if (tables.length) passed.push(`${tables.length} tables with <th>`);
  const links = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].filter((m) => !/aria-label\s*=/i.test(m[0])).map((m) => strip(m[1]));
  group(findings, "warning", "links do not say where they go", links.filter((t) => !t || badLinkText(t)).map((t) => t || "(no text)"), "Use link text that names the target.");
  const ids = new Set([...html.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']+)/gi)].map((m) => m[1]));
  const fields = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)].filter((m) => !/type\s*=\s*["']?(hidden|submit|button|reset|image)/i.test(m[0]));
  const unlabeled = fields.filter((m) => !/aria-label(ledby)?\s*=|\stitle\s*=/i.test(m[0]) && !ids.has(attr(m[0], "id") ?? "\0")).map((m) => attr(m[0], "name") ?? attr(m[0], "id") ?? m[1]);
  group(findings, "error", "form fields have no label", unlabeled, "Add a <label for=\"id\"> for each field.");
  return { kind: "HTML", summary: `${headings.length} headings, ${imgs.length} images, ${tables.length} tables`, findings, passed };
}

export async function checkFile(path: string): Promise<Report> {
  const ext = extname(path).toLowerCase();
  const data = readFileSync(path);
  if (ext === ".pdf") return checkPdf(new Uint8Array(data));
  if (ext === ".docx") return checkDocx(data);
  if (ext === ".html" || ext === ".htm") return checkHtml(data.toString("utf8"));
  throw new Error(`a11y_check cannot check ${ext || "this"} files. It checks .pdf, .docx, .html, and .htm files.`);
}

export function formatReport(path: string, r: Report): string {
  const errors = r.findings.filter((f) => f.level === "error");
  const warnings = r.findings.filter((f) => f.level === "warning");
  return [
    `Accessibility check: ${path} (${r.kind}, ${r.summary})`,
    r.findings.length ? `${errors.length} errors, ${warnings.length} warnings:` : "No problems found.",
    ...errors.map((f) => `- ERROR: ${f.text}`),
    ...warnings.map((f) => `- WARNING: ${f.text}`),
    r.passed.length ? `Passed: ${r.passed.join("; ")}.` : "",
    "Limits: this check finds common problems only. A person must still check that the alt text is correct, that the reading order is logical, " +
      "that color is not the only way to show meaning, and that the language is clear. For PDF/UA conformance, use a validator such as veraPDF or PAC.",
  ].filter(Boolean).join("\n");
}

export function registerA11yCheck(pi: ExtensionAPI) {
  pi.registerTool({
    name: "a11y_check",
    label: "Accessibility check",
    description:
      "Check a .pdf, .docx, or .html file for common accessibility problems: tags, title, language, headings, alt text, " +
      "table headers, link text, fonts, and contrast. Gives errors, warnings, and what passed.",
    promptSnippet: "Check PDF, Word, and HTML files for accessibility problems",
    promptGuidelines: [
      "After you write a document for other people (pdf_write, docx_write, or an HTML page), run a11y_check on it. Fix the errors and the warnings, then run it again.",
    ],
    parameters: Type.Object({ path: Type.String({ description: "Path to the .pdf, .docx, .html, or .htm file" }) }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const report = await checkFile(fullPath(ctx.cwd, params.path));
      return { content: [{ type: "text", text: formatReport(params.path, report) }], details: { findings: report.findings } };
    },
  });
}
