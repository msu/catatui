// PowerPoint tools: the model can write .pptx files with no Python (python-pptx). Students often have no Python.
// pptx_write is a file change, so sandbox.ts, permissions.ts, and undo.ts treat it like "write".
// See src/md/features/pptx.md.
// pptxgenjs loads when a tool runs first, not at catatui start. This keeps the start fast.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { Type } from "typebox";

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

export function registerPptxTools(pi: ExtensionAPI) {
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
