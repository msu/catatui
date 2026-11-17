// PowerPoint tools: the model can read and write .pptx files with no Python (python-pptx). Students often have no Python.
// pptx_write is a file change, so sandbox.ts, permissions.ts, and undo.ts treat it like "write". pptx_read is a read tool.
// pptx_read opens the zip with jszip and reads the slide XML with small regular expressions (no XML library).
// See src/md/features/pptx.md.
// pptxgenjs loads when a tool runs first, not at catatui start. This keeps the start fast.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, isAbsolute, posix } from "node:path";
import { Type } from "typebox";
import { EDIT_PARAMS, editDeck, type Edit } from "./pptx-edit.ts";

// The deck themes. "msu" is the default. The student can ask for "plain".
// TODO: verify the MSU colors with the MSU brand guide. These hex values are placeholders, not confirmed.
// The MSU logo is not used (trademark).
export const THEMES = {
  msu: {
    dark: "003875", // TODO: verify with the MSU brand guide (MSU blue)
    accent: "F2AE00", // TODO: verify with the MSU brand guide (MSU gold)
    text: "222222",
    light: "FFFFFF",
    font: "Arial",
    footer: "Montana State University",
  },
  plain: {
    dark: "1F2937",
    accent: "4472C4",
    text: "222222",
    light: "FFFFFF",
    font: "Calibri",
    footer: "",
  },
} as const;
type Theme = (typeof THEMES)[keyof typeof THEMES];

// LAYOUT_WIDE (pptxgenjs): 13.33 x 7.5 inches, 16:9.
const W = 13.33;
const H = 7.5;
const M = 0.6; // side margin
const BODY_Y = 1.45;
const BODY_H = H - BODY_Y - 0.8;

const BULLET = Type.Union([
  Type.String(),
  Type.Object({ text: Type.String(), level: Type.Optional(Type.Integer({ minimum: 0, maximum: 4, description: "0 is the top level" })) }),
]);
const BULLETS = Type.Array(BULLET, { description: "Bullet lines. A string, or { text, level } for a sub-bullet (level 1, 2...)" });

const SLIDE = Type.Object({
  layout: Type.Union(
    [Type.Literal("title"), Type.Literal("bullets"), Type.Literal("two-columns"), Type.Literal("image"), Type.Literal("table"), Type.Literal("chart")],
    { description: "title: a title slide (title, subtitle). bullets: title and bullets. two-columns: bullets and right. image: title, image, and bullets as a caption. table: title and table. chart: title and chart." },
  ),
  title: Type.String(),
  subtitle: Type.Optional(Type.String({ description: "For the title layout" })),
  bullets: Type.Optional(BULLETS),
  right: Type.Optional(Type.Array(BULLET, { description: "The right column of the two-columns layout" })),
  image: Type.Optional(Type.String({ description: "Path to a .png or .jpg image in the project" })),
  table: Type.Optional(Type.Array(Type.Array(Type.String()), { description: "Table rows. The first row is the header." })),
  chart: Type.Optional(Type.Object({
    type: Type.Union([Type.Literal("bar"), Type.Literal("line"), Type.Literal("pie")]),
    labels: Type.Array(Type.String(), { description: "Category labels" }),
    series: Type.Array(Type.Object({ name: Type.String(), values: Type.Array(Type.Number()) }), { description: "One or more data series. A pie chart uses the first series." }),
  })),
  notes: Type.Optional(Type.String({ description: "Speaker notes" })),
});

const WRITE_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .pptx file. The tool replaces the file if it exists." }),
  slides: Type.Array(SLIDE, { description: "The slides, in order" }),
  theme: Type.Optional(Type.Union([Type.Literal("msu"), Type.Literal("plain")], { description: "msu (default): MSU blue and gold. plain: neutral colors, no MSU footer." })),
});

type Bullet = string | { text: string; level?: number };
interface Slide {
  layout: "title" | "bullets" | "two-columns" | "image" | "table" | "chart";
  title: string; subtitle?: string; bullets?: Bullet[]; right?: Bullet[]; image?: string;
  table?: string[][]; chart?: { type: "bar" | "line" | "pie"; labels: string[]; series: { name: string; values: number[] }[] }; notes?: string;
}

const fullPath = (cwd: string, path: string) => resolve(cwd, path.replace(/^@/, ""));

// An image must be a file in the project, so the tool does not copy other files of the student into a deck.
function imagePath(cwd: string, path: string): string {
  const full = fullPath(cwd, path);
  const rel = relative(cwd, full);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`The image ${path} is not in the project folder. Copy it into the project, then try again.`);
  if (!existsSync(full)) throw new Error(`The image ${path} does not exist. Check the path, then try again.`);
  // Check the first bytes, not only the name. pptxgenjs reads the size with image-size, and some of its other
  // parsers (JXL, HEIF, ICNS) can loop forever on a bad file (npm audit). Only PNG, JPEG, and GIF get to it.
  const head = readFileSync(full).subarray(0, 8);
  const png = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const gif = head.subarray(0, 4).toString("latin1") === "GIF8";
  if (!png && !jpg && !gif) throw new Error(`The image ${path} is not a PNG, JPEG, or GIF image. Use one of these types.`);
  return full;
}

const bulletRuns = (items: Bullet[], t: Theme, size: number) =>
  items.map((b) => {
    const text = typeof b === "string" ? b : b.text;
    const level = typeof b === "string" ? 0 : Math.min(4, Math.max(0, b.level ?? 0));
    return { text, options: { bullet: { indent: 15 }, indentLevel: level, fontSize: level ? size - 4 : size, color: t.text, breakLine: true, paraSpaceAfter: 6 } };
  });

// The pptxgenjs objects are not typed here, because the module loads at run time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pptx = any;

function defineMasters(pptx: Pptx, t: Theme) {
  const footer = t.footer ? [{ text: { text: t.footer, options: { x: M, y: H - 0.5, w: 8, h: 0.35, fontFace: t.font, fontSize: 11, color: "666666" } } }] : [];
  pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: t.light },
    objects: [
      { rect: { x: 0, y: 0, w: W, h: 0.12, fill: { color: t.dark } } },
      { rect: { x: M, y: 1.2, w: W - 2 * M, h: 0.05, fill: { color: t.accent } } },
      ...footer,
    ],
    slideNumber: { x: W - M - 0.6, y: H - 0.5, w: 0.6, h: 0.35, fontFace: t.font, fontSize: 11, color: "666666" },
  });
  pptx.defineSlideMaster({
    title: "TITLE",
    background: { color: t.dark },
    objects: [
      { rect: { x: M, y: 4.05, w: 3, h: 0.08, fill: { color: t.accent } } },
      ...(t.footer ? [{ text: { text: t.footer, options: { x: M, y: H - 0.8, w: 8, h: 0.4, fontFace: t.font, fontSize: 14, color: t.light } } }] : []),
    ],
  });
}

function addSlide(pptx: Pptx, s: Slide, t: Theme, cwd: string) {
  if (s.layout === "title") {
    const slide = pptx.addSlide({ masterName: "TITLE" });
    slide.addText(s.title, { x: M, y: 1.8, w: W - 2 * M, h: 2.1, fontFace: t.font, fontSize: 40, bold: true, color: t.light, valign: "bottom", fit: "shrink" });
    if (s.subtitle) slide.addText(s.subtitle, { x: M, y: 4.3, w: W - 2 * M, h: 1.2, fontFace: t.font, fontSize: 22, color: t.light, valign: "top", fit: "shrink" });
    if (s.notes) slide.addNotes(s.notes);
    return;
  }
  const slide = pptx.addSlide({ masterName: "CONTENT" });
  slide.addText(s.title, { x: M, y: 0.3, w: W - 2 * M, h: 0.85, fontFace: t.font, fontSize: 30, bold: true, color: t.dark, valign: "bottom", fit: "shrink" });
  const body = { fontFace: t.font, valign: "top" as const, fit: "shrink" as const };
  const fullW = W - 2 * M;
  const half = (fullW - 0.4) / 2;

  if (s.layout === "bullets" && s.bullets?.length) {
    slide.addText(bulletRuns(s.bullets, t, 22), { x: M, y: BODY_Y, w: fullW, h: BODY_H, ...body });
  } else if (s.layout === "two-columns") {
    if (s.bullets?.length) slide.addText(bulletRuns(s.bullets, t, 20), { x: M, y: BODY_Y, w: half, h: BODY_H, ...body });
    if (s.right?.length) slide.addText(bulletRuns(s.right, t, 20), { x: M + half + 0.4, y: BODY_Y, w: half, h: BODY_H, ...body });
  } else if (s.layout === "image") {
    if (!s.image) throw new Error(`Slide "${s.title}" has the image layout but no image. Add the image path.`);
    const captionH = s.bullets?.length ? 1.1 : 0;
    const h = BODY_H - captionH;
    slide.addImage({ path: imagePath(cwd, s.image), x: M, y: BODY_Y, w: fullW, h, sizing: { type: "contain", w: fullW, h }, altText: s.title });
    if (captionH) slide.addText(bulletRuns(s.bullets!, t, 16), { x: M, y: BODY_Y + h + 0.1, w: fullW, h: captionH - 0.1, ...body });
  } else if (s.layout === "table") {
    if (!s.table?.length) throw new Error(`Slide "${s.title}" has the table layout but no table rows. Add the rows.`);
    const rows = s.table.map((r, i) => r.map((c) => ({
      text: String(c),
      options: i === 0 ? { bold: true, color: t.light, fill: { color: t.dark } } : { color: t.text, fill: { color: i % 2 ? "FFFFFF" : "F2F4F7" } },
    })));
    slide.addTable(rows, { x: M, y: BODY_Y, w: fullW, fontFace: t.font, fontSize: 14, border: { type: "solid", color: "BFC5CE", pt: 1 }, autoPage: false });
  } else if (s.layout === "chart") {
    if (!s.chart?.series.length) throw new Error(`Slide "${s.title}" has the chart layout but no chart data. Add the labels and the series.`);
    const data = (s.chart.type === "pie" ? s.chart.series.slice(0, 1) : s.chart.series).map((x) => ({ name: x.name, labels: s.chart!.labels, values: x.values }));
    slide.addChart(s.chart.type, data, {
      x: M, y: BODY_Y, w: fullW, h: BODY_H,
      chartColors: [t.dark, t.accent, "7A8899", "B5C4D6", "A05A00"],
      showLegend: s.chart.series.length > 1 || s.chart.type === "pie", legendPos: "b",
      catAxisLabelFontFace: t.font, valAxisLabelFontFace: t.font, legendFontFace: t.font,
      showValue: s.chart.type === "pie",
    });
  } else if (s.bullets?.length) {
    slide.addText(bulletRuns(s.bullets, t, 22), { x: M, y: BODY_Y, w: fullW, h: BODY_H, ...body });
  }
  if (s.notes) slide.addNotes(s.notes);
}

// Make the deck. Exported for the tests.
export async function writeDeck(path: string, slides: Slide[], themeName: "msu" | "plain" = "msu", cwd = dirname(path)): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx: Pptx = new PptxGenJS();
  const t = THEMES[themeName] ?? THEMES.msu;
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = slides[0]?.title ?? "Presentation";
  pptx.theme = { headFontFace: t.font, bodyFontFace: t.font };
  defineMasters(pptx, t);
  for (const s of slides) addSlide(pptx, s, t, cwd);
  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

// ---- pptx_read ----

const MAX_CHARS = 50_000;

const READ_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .pptx file" }),
});

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const xmlText = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()]);
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

// The relationships of a part: id -> the full path in the zip.
async function rels(zip: JSZipLike, part: string): Promise<Map<string, { type: string; target: string }>> {
  const relPath = posix.join(posix.dirname(part), "_rels", `${posix.basename(part)}.rels`);
  const xml = await zip.file(relPath)?.async("string");
  const out = new Map<string, { type: string; target: string }>();
  for (const m of xml?.matchAll(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (!id || !target || attr(m[0], "TargetMode") === "External") continue;
    const full = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(posix.dirname(part), target));
    out.set(id, { type: (attr(m[0], "Type") ?? "").split("/").pop()!, target: full });
  }
  return out;
}

// The paragraphs of a text body: the level and the text.
function paragraphs(xml: string): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = [];
  for (const p of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    const body = p[1] ?? p[2] ?? "";
    const pPr = /<a:pPr\b[^>]*>/.exec(body)?.[0] ?? "";
    const level = Number(attr(pPr, "lvl") ?? 0);
    const text = [...body.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:br\/>/g)].map((t) => (t[1] === undefined ? "\n" : xmlText(t[1]))).join("");
    if (text.trim()) out.push({ level, text });
  }
  return out;
}

interface JSZipLike { file(path: string): { async(type: "string"): Promise<string> } | null; files: Record<string, unknown> }

export interface SlideInfo { n: number; hidden: boolean; title: string; texts: { level: number; text: string }[][]; tables: string[][][]; images: string[]; charts: number; notes: string }

// The slides of a deck in order (presentation.xml), with the text, the tables, the images, and the notes.
export async function readSlides(data: Buffer): Promise<SlideInfo[]> {
  const JSZip = (await import("jszip")).default;
  const zip = (await JSZip.loadAsync(data)) as unknown as JSZipLike;
  const pres = await zip.file("ppt/presentation.xml")?.async("string");
  if (!pres) throw new Error("The file is not a PowerPoint .pptx file (no ppt/presentation.xml). Check the file.");
  const presRels = await rels(zip, "ppt/presentation.xml");
  const ids = [...(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1] ?? "").matchAll(/<p:sldId\b[^>]*>/g)].map((m) => attr(m[0], "r:id"));
  const slides: SlideInfo[] = [];
  for (const [i, id] of ids.entries()) {
    const part = id ? presRels.get(id)?.target : undefined;
    const xml = part ? await zip.file(part)?.async("string") : undefined;
    if (!part || !xml) continue;
    const slideRels = await rels(zip, part);
    const info: SlideInfo = { n: i + 1, hidden: /<p:sld\b[^>]*\bshow="0"/.test(xml), title: "", texts: [], tables: [], images: [], charts: 0, notes: "" };
    // Shapes, pictures, and graphic frames (tables, charts) in document order.
    for (const m of xml.matchAll(/<p:(sp|pic|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
      const el = m[0];
      if (m[1] === "sp") {
        const paras = paragraphs(/<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(el)?.[1] ?? "");
        if (!paras.length) continue;
        const ph = attr(/<p:ph\b[^>]*>/.exec(el)?.[0] ?? "", "type");
        // The slide number, the date, and the footer are not slide content.
        if (ph === "sldNum" || ph === "dt" || ph === "ftr") continue;
        if (!info.title && (ph === "title" || ph === "ctrTitle")) info.title = paras.map((p) => p.text).join(" ");
        else info.texts.push(paras);
      } else if (m[1] === "pic") {
        const nv = /<p:cNvPr\b[^>]*>/.exec(el)?.[0] ?? "";
        info.images.push(xmlText(attr(nv, "descr") || attr(nv, "name") || "image"));
      } else if (/<a:tbl>/.test(el)) {
        info.tables.push([...el.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)].map((tr) =>
          [...tr[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].map((tc) => paragraphs(tc[0]).map((p) => p.text).join(" "))));
      } else if (/\/chart"/.test(el)) {
        info.charts++;
      }
    }
    // No title placeholder (for example a pptx_write deck): the first text shape is the title.
    if (!info.title && info.texts.length) info.title = info.texts.shift()!.map((p) => p.text).join(" ");
    const notesPart = [...slideRels.values()].find((r) => r.type === "notesSlide")?.target;
    const notesXml = notesPart ? await zip.file(notesPart)?.async("string") : undefined;
    if (notesXml) {
      const body = [...notesXml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].find((s) => attr(/<p:ph\b[^>]*>/.exec(s[0])?.[0] ?? "", "type") === "body");
      if (body) info.notes = paragraphs(body[0]).map((p) => p.text).join("\n");
    }
    slides.push(info);
  }
  return slides;
}

export function slidesText(slides: SlideInfo[]): string {
  const out: string[] = [`${slides.length} slides`];
  for (const s of slides) {
    out.push("", `## Slide ${s.n}${s.hidden ? " (hidden)" : ""}: ${s.title || "(no title)"}`);
    for (const shape of s.texts) for (const p of shape) out.push(`${"  ".repeat(p.level)}- ${p.text.replace(/\n/g, " / ")}`);
    for (const t of s.tables) {
      out.push("Table:");
      for (const row of t) out.push(row.join("\t"));
    }
    if (s.images.length) out.push(`Images: ${s.images.join(", ")}`);
    if (s.charts) out.push(`Charts: ${s.charts}`);
    if (s.notes) out.push(`Notes: ${s.notes.replace(/\n/g, " / ")}`);
  }
  const text = out.join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[Output cut at ${MAX_CHARS} characters.]` : text;
}

export function registerPptxTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "pptx_edit",
    label: "PowerPoint edit",
    description:
      "Change a PowerPoint .pptx file that exists, and keep its formatting. Edits: replace_text (on one slide; keeps the text format), " +
      "set_notes, delete_slide, move_slide, and add_slide (a copy of a template slide with a new title and bullets; charts are not copied). " +
      "Read the deck with pptx_read first. Slide numbers are the numbers after the edits before them. If one edit fails, the file does not change. " +
      "It cannot change layouts, images, charts, or SmartArt. For a new deck, use pptx_write.",
    promptSnippet: "Change an existing PowerPoint .pptx deck and keep its formatting",
    promptGuidelines: ["To change a .pptx that the student already has, use pptx_edit, not pptx_write: pptx_write replaces the whole deck and its formatting."],
    parameters: EDIT_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const done = await editDeck(fullPath(ctx.cwd, params.path), params.edits as Edit[]);
      return { content: [{ type: "text", text: `Changed ${params.path}:\n${done.map((d) => `- ${d}`).join("\n")}` }], details: { edits: done.length } };
    },
  });

  pi.registerTool({
    name: "pptx_read",
    label: "PowerPoint read",
    description: `Read a PowerPoint .pptx file. Returns each slide in order: the number, the title, the text (with bullet levels), the tables, the image names, the number of charts, and the speaker notes. At most ${MAX_CHARS} characters.`,
    promptSnippet: "Read PowerPoint .pptx files (use this, not Python)",
    promptGuidelines: ["For .pptx files, use pptx_read to read them. Do not use read, bash, or Python (python-pptx) for them."],
    parameters: READ_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const slides = await readSlides(readFileSync(fullPath(ctx.cwd, params.path)));
      return { content: [{ type: "text", text: slidesText(slides) }], details: { slides: slides.length } };
    },
  });

  pi.registerTool({
    name: "pptx_write",
    label: "PowerPoint write",
    description:
      "Write a PowerPoint .pptx file. Replaces the file if it exists. " +
      "Layouts: title, bullets, two-columns, image (a .png or .jpg in the project), table, chart (bar, line, pie). Each slide can have speaker notes. " +
      "The default theme is MSU (blue and gold, with a \"Montana State University\" footer). Use theme \"plain\" if the student asks for a different look.",
    promptSnippet: "Write PowerPoint .pptx decks (use this, not Python)",
    promptGuidelines: ["For .pptx files, use pptx_write. Do not use Python (python-pptx) or bash for them. The student can have no Python."],
    parameters: WRITE_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const path = fullPath(ctx.cwd, params.path);
      await writeDeck(path, params.slides as Slide[], params.theme ?? "msu", ctx.cwd);
      return { content: [{ type: "text", text: `Wrote ${params.path}: ${params.slides.length} slides (theme ${params.theme ?? "msu"})` }], details: { slides: params.slides.length } };
    },
  });
}
