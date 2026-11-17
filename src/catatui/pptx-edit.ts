// "pptx_edit": change a .pptx deck that exists, and keep its formatting. pptx_write replaces the whole file.
// The tool changes the XML in the zip (jszip) directly. pptxgenjs cannot open a file.
// Only edits that cannot damage the file are here. See src/md/features/pptx.md (the card-14 investigation).
// All edits run in memory first. If one edit fails, the tool does not write the file.

import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { Type } from "typebox";

const T_SLIDE = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const T_NOTES = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const BULLET = Type.Union([Type.String(), Type.Object({ text: Type.String(), level: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })) })]);
const SLIDE_N = Type.Integer({ minimum: 1, description: "Slide number (1 is the first), as pptx_read shows it at the time of this edit" });

export const EDIT_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .pptx file. The tool changes this file." }),
  edits: Type.Array(
    Type.Union([
      Type.Object({ op: Type.Literal("replace_text"), slide: SLIDE_N, old: Type.String(), new: Type.String(), all: Type.Optional(Type.Boolean({ description: "Replace all matches on the slide. Default: false (exactly one match)" })) }),
      Type.Object({ op: Type.Literal("set_notes"), slide: SLIDE_N, notes: Type.String({ description: "The new speaker notes. An empty string removes the text." }) }),
      Type.Object({ op: Type.Literal("delete_slide"), slide: SLIDE_N }),
      Type.Object({ op: Type.Literal("move_slide"), slide: SLIDE_N, to: Type.Integer({ minimum: 1, description: "The new slide number" }) }),
      Type.Object({
        op: Type.Literal("add_slide"),
        template: Type.Integer({ minimum: 1, description: "The slide to copy (its layout, background, and formatting)" }),
        after: Type.Optional(Type.Integer({ minimum: 0, description: "Put the new slide after this slide number. 0: first. Default: last" })),
        title: Type.String(),
        bullets: Type.Optional(Type.Array(BULLET, { description: "The body text. A string, or { text, level } for a sub-bullet" })),
      }),
    ]),
    { description: "The edits, in order. Slide numbers are the numbers after the edits before them." },
  ),
});

export type Edit =
  | { op: "replace_text"; slide: number; old: string; new: string; all?: boolean }
  | { op: "set_notes"; slide: number; notes: string }
  | { op: "delete_slide"; slide: number }
  | { op: "move_slide"; slide: number; to: number }
  | { op: "add_slide"; template: number; after?: number; title: string; bullets?: (string | { text: string; level?: number })[] };

// ---- small XML helpers (strings, no XML library) ----

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unesc = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()]);
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const relsPath = (part: string) => posix.join(posix.dirname(part), "_rels", `${posix.basename(part)}.rels`);
const relTarget = (from: string, target: string) => (target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join(posix.dirname(from), target)));
// A paragraph: <a:p>...</a:p> or <a:p/>. Not <a:pPr>.
const PARA = /<a:p>[\s\S]*?<\/a:p>|<a:p\b[^>]*?\/>|<a:p\s[^>]*>[\s\S]*?<\/a:p>/g;
const P_PR = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/;
const R_PR = /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/;

interface Rel { id: string; type: string; target: string; tag: string }

// The deck in memory: the zip and the parts that the edits change.
class Deck {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zip: any;
  files = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(zip: any) { this.zip = zip; }

  static async open(data: Buffer): Promise<Deck> {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(data);
    const deck = new Deck(zip);
    if (!(await deck.read("ppt/presentation.xml"))) throw new Error("The file is not a PowerPoint .pptx file (no ppt/presentation.xml). Check the file.");
    return deck;
  }

  async read(path: string): Promise<string | undefined> {
    if (this.files.has(path)) return this.files.get(path);
    const f = this.zip.file(path);
    if (!f) return undefined;
    const s = await f.async("string");
    this.files.set(path, s);
    return s;
  }
  async must(path: string): Promise<string> {
    const s = await this.read(path);
    if (s === undefined) throw new Error(`The deck has no ${path}. The file can be damaged.`);
    return s;
  }
  set(path: string, s: string) { this.files.set(path, s); this.zip.file(path, s); }
  remove(path: string) { this.files.delete(path); this.zip.remove(path); }
  exists(path: string) { return !!this.zip.file(path); }

  async rels(part: string): Promise<Rel[]> {
    const xml = (await this.read(relsPath(part))) ?? "";
    return [...xml.matchAll(/<Relationship\b[^>]*\/>|<Relationship\b[^>]*>[\s\S]*?<\/Relationship>/g)].map((m) => ({
      id: attr(m[0], "Id") ?? "", type: (attr(m[0], "Type") ?? "").split("/").pop()!, tag: m[0],
      target: attr(m[0], "TargetMode") === "External" ? "" : relTarget(part, attr(m[0], "Target") ?? ""),
    }));
  }
  async addRel(part: string, type: string, to: string): Promise<string> {
    const path = relsPath(part);
    const xml = (await this.read(path)) ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const used = [...xml.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
    const id = `rId${Math.max(0, ...used) + 1}`;
    const target = posix.relative(posix.dirname(part), to);
    this.set(path, xml.replace("</Relationships>", `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/></Relationships>`));
    return id;
  }
  async removeRel(part: string, id: string) {
    const path = relsPath(part);
    const xml = await this.read(path);
    if (xml) this.set(path, xml.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*/>`), ""));
  }
  async addOverride(part: string, type: string) {
    const ct = await this.must("[Content_Types].xml");
    if (ct.includes(`PartName="/${part}"`)) return;
    this.set("[Content_Types].xml", ct.replace("</Types>", `<Override PartName="/${part}" ContentType="${type}"/></Types>`));
  }
  async removeOverride(part: string) {
    const ct = await this.must("[Content_Types].xml");
    this.set("[Content_Types].xml", ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${part.replace(/[.[\]]/g, "\\$&")}"[^>]*/>`), ""));
  }

  // The slides in order: the sldId tag, its id, the rel id, and the part.
  async slides(): Promise<{ tag: string; id: string; rid: string; part: string }[]> {
    const pres = await this.must("ppt/presentation.xml");
    const rels = await this.rels("ppt/presentation.xml");
    const list = /<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(pres)?.[1] ?? "";
    return [...list.matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => {
      const rid = attr(m[0], "r:id") ?? "";
      return { tag: m[0], id: attr(m[0], "id") ?? "", rid, part: rels.find((r) => r.id === rid)?.target ?? "" };
    });
  }
  async slide(n: number) {
    const all = await this.slides();
    const s = all[n - 1];
    if (!s?.part) throw new Error(`The deck has no slide ${n}. It has ${all.length} slides. Read it again with pptx_read.`);
    return s;
  }
  async setOrder(tags: string[]) {
    const pres = await this.must("ppt/presentation.xml");
    this.set("ppt/presentation.xml", pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>|<p:sldIdLst\/>/, `<p:sldIdLst>${tags.join("")}</p:sldIdLst>`));
  }

  // Sections (p14:sectionLst): each slide id is in one section. Remove an id, or put it next to another id.
  async sectionRemove(id: string) {
    const pres = await this.must("ppt/presentation.xml");
    this.set("ppt/presentation.xml", pres.replace(new RegExp(`<p14:sldId\\s+id="${id}"\\s*/>`), ""));
  }
  async sectionInsert(id: string, order: string[]) {
    const pres = await this.must("ppt/presentation.xml");
    if (!pres.includes("<p14:sectionLst")) return;
    const i = order.indexOf(id);
    const tag = `<p14:sldId id="${id}"/>`;
    const before = order[i - 1];
    const after = order[i + 1];
    let out = pres;
    if (before && new RegExp(`<p14:sldId\\s+id="${before}"\\s*/>`).test(out)) out = out.replace(new RegExp(`<p14:sldId\\s+id="${before}"\\s*/>`), (m) => m + tag);
    else if (after && new RegExp(`<p14:sldId\\s+id="${after}"\\s*/>`).test(out)) out = out.replace(new RegExp(`<p14:sldId\\s+id="${after}"\\s*/>`), (m) => tag + m);
    else out = out.replace(/<p14:sldIdLst\s*\/>/, `<p14:sldIdLst>${tag}</p14:sldIdLst>`).replace(/<p14:sldIdLst>/, (m) => (out.includes(tag) ? m : m + tag));
    this.set("ppt/presentation.xml", out);
  }

  async updateAppCount() {
    const app = await this.read("docProps/app.xml");
    if (app) this.set("docProps/app.xml", app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${(await this.slides()).length}</Slides>`));
  }
}

// ---- the edits ----

// Replace text in the paragraphs of one slide. A match can span runs: the new text goes in the first run of the
// match, so it gets that run's formatting. Returns the number of matches.
export function replaceInXml(xml: string, old: string, neu: string, all: boolean): { xml: string; count: number } {
  if (!old) throw new Error("The old text is empty. Give the text to replace.");
  let count = 0;
  const out = xml.replace(PARA, (para) => {
    const segs: { start: number; end: number; text: string }[] = [];
    for (const m of para.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:t\s[^>]*>([\s\S]*?)<\/a:t>/g)) {
      const inner = m[1] ?? m[2] ?? "";
      const open = m[0].slice(0, m[0].indexOf(">") + 1);
      segs.push({ start: m.index! + open.length, end: m.index! + open.length + inner.length, text: unesc(inner) });
    }
    const full = segs.map((s) => s.text).join("");
    const hits: number[] = [];
    for (let i = full.indexOf(old); i >= 0; i = full.indexOf(old, i + old.length)) hits.push(i);
    if (!hits.length) return para;
    count += hits.length;
    const texts = segs.map((s) => s.text);
    // From the last match to the first, so the offsets of the earlier matches stay correct.
    for (const at of hits.reverse()) {
      let pos = 0;
      let first = -1;
      for (let k = 0; k < texts.length; k++) {
        const a = pos;
        const b = pos + texts[k].length;
        pos = b;
        // The part of the match in this run. No part: the next run.
        const s = Math.max(at, a);
        const e = Math.min(at + old.length, b);
        if (s >= e) continue;
        const local = [s - a, e - a];
        if (first < 0) {
          first = k;
          texts[k] = texts[k].slice(0, local[0]) + neu + texts[k].slice(local[1]);
        } else {
          texts[k] = texts[k].slice(0, local[0]) + texts[k].slice(local[1]);
        }
      }
    }
    // Put the new texts back, from the end, so the offsets in para stay correct.
    let p = para;
    for (let k = segs.length - 1; k >= 0; k--) p = p.slice(0, segs[k].start) + esc(texts[k]) + p.slice(segs[k].end);
    return p;
  });
  return { xml: out, count };
}

// New paragraphs for a text body. Each level uses the first paragraph of that level (or the first paragraph) as the format.
function paragraphsLike(body: string, items: { text: string; level: number }[]): string {
  const paras = body.match(PARA) ?? [];
  const fmt = (level: number) => {
    const p = paras.find((x) => Number(attr(P_PR.exec(x)?.[0] ?? "", "lvl") ?? 0) === level) ?? paras[0] ?? "";
    let pPr = P_PR.exec(p)?.[0] ?? "";
    if (pPr || level) {
      if (!pPr) pPr = "<a:pPr/>";
      pPr = pPr.replace(/\slvl="\d+"/, "");
      if (level) pPr = pPr.replace(/^<a:pPr/, `<a:pPr lvl="${level}"`);
    }
    const rPr = R_PR.exec(p)?.[0] ?? "";
    return { pPr, rPr };
  };
  if (!items.length) return "<a:p/>";
  return items.map((it) => {
    const { pPr, rPr } = fmt(it.level);
    return `<a:p>${pPr}<a:r>${rPr}<a:t>${esc(it.text)}</a:t></a:r></a:p>`;
  }).join("");
}

// Replace all paragraphs in the txBody of a shape (keep bodyPr and lstStyle).
function setBody(sp: string, items: { text: string; level: number }[]): string {
  const tb = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(sp);
  if (!tb) return sp.replace(/<\/p:sp>$/, `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphsLike("", items)}</p:txBody></p:sp>`);
  const inner = tb[1];
  const head = inner.replace(PARA, "\u0000").split("\u0000")[0];
  return sp.replace(tb[0], `<p:txBody>${head}${paragraphsLike(inner, items)}</p:txBody>`);
}

const shapes = (xml: string) => [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
const phType = (sp: string) => { const ph = /<p:ph\b[^>]*>/.exec(sp)?.[0]; return ph ? { type: attr(ph, "type"), idx: attr(ph, "idx") } : undefined; };
const hasText = (sp: string) => /<p:txBody>/.test(sp);

async function setNotes(deck: Deck, n: number, notes: string) {
  const s = await deck.slide(n);
  const items = notes.split("\n").map((text) => ({ text, level: 0 })).filter((x, i, a) => x.text || a.length === 1);
  const rels = await deck.rels(s.part);
  const notesPart = rels.find((r) => r.type === "notesSlide")?.target;
  if (notesPart && deck.exists(notesPart)) {
    const xml = await deck.must(notesPart);
    const body = shapes(xml).find((sp) => phType(sp)?.type === "body");
    if (!body) throw new Error(`The notes of slide ${n} have no notes text box. pptx_edit cannot set them safely.`);
    deck.set(notesPart, xml.replace(body, setBody(body, notes ? items : [])));
    return;
  }
  const presRels = await deck.rels("ppt/presentation.xml");
  const master = presRels.find((r) => r.type === "notesMaster")?.target;
  if (!master || !deck.exists(master)) throw new Error(`Slide ${n} has no notes, and the deck has no notes master. pptx_edit cannot add notes safely to this deck. Add one note in PowerPoint first, then try again.`);
  const used = Object.keys(deck.zip.files).map((f) => /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(f)?.[1]).filter(Boolean).map(Number);
  const part = `ppt/notesSlides/notesSlide${Math.max(0, ...used) + 1}.xml`;
  deck.set(part, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphsLike("", notes ? items : [])}</p:txBody></p:sp>` +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
  await deck.addRel(part, "notesMaster", master);
  await deck.addRel(part, "slide", s.part);
  await deck.addRel(s.part, "notesSlide", part);
  await deck.addOverride(part, T_NOTES);
}

async function deleteSlide(deck: Deck, n: number) {
  const all = await deck.slides();
  const s = await deck.slide(n);
  if (all.length === 1) throw new Error("The deck has only one slide. pptx_edit does not delete the last slide.");
  for (const o of all) {
    if (o.id === s.id || !o.part) continue;
    if ((await deck.rels(o.part)).some((r) => r.type === "slide" && r.target === s.part)) {
      throw new Error(`Slide ${all.indexOf(o) + 1} has a link to slide ${n}. Remove the link first, then delete the slide.`);
    }
  }
  await deck.setOrder(all.filter((o) => o.id !== s.id).map((o) => o.tag));
  await deck.sectionRemove(s.id);
  // Custom shows refer to the slide with its presentation rel id.
  const pres = await deck.must("ppt/presentation.xml");
  deck.set("ppt/presentation.xml", pres.replace(new RegExp(`<p:sld\\s+r:id="${s.rid}"\\s*/>`, "g"), ""));
  await deck.removeRel("ppt/presentation.xml", s.rid);
  const notes = (await deck.rels(s.part)).find((r) => r.type === "notesSlide")?.target;
  if (notes) {
    deck.remove(notes);
    deck.remove(relsPath(notes));
    await deck.removeOverride(notes);
  }
  deck.remove(s.part);
  deck.remove(relsPath(s.part));
  await deck.removeOverride(s.part);
  await deck.updateAppCount();
}

async function moveSlide(deck: Deck, n: number, to: number) {
  const all = await deck.slides();
  const s = await deck.slide(n);
  if (to > all.length) throw new Error(`The deck has ${all.length} slides, so slide ${to} does not exist. Use a number from 1 to ${all.length}.`);
  const rest = all.filter((o) => o.id !== s.id);
  rest.splice(to - 1, 0, s);
  await deck.setOrder(rest.map((o) => o.tag));
  await deck.sectionRemove(s.id);
  await deck.sectionInsert(s.id, rest.map((o) => o.id));
}

async function addSlide(deck: Deck, e: Extract<Edit, { op: "add_slide" }>) {
  const all = await deck.slides();
  const t = await deck.slide(e.template);
  const after = e.after ?? all.length;
  if (after > all.length) throw new Error(`The deck has ${all.length} slides. Use "after" from 0 to ${all.length}.`);
  let xml = await deck.must(t.part);
  // Two slides cannot share one chart part safely, so the copy has no charts.
  xml = xml.replace(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g, (g) => (/\/chart"/.test(g) ? "" : g));
  // The PowerPoint creation id must be unique for each slide.
  xml = xml.replace(/<p:ext\b[^>]*>\s*<p14:creationId\b[^>]*\/>\s*<\/p:ext>/g, "").replace(/<p:extLst>\s*<\/p:extLst>/g, "");

  const sps = shapes(xml);
  const titleSp = sps.find((sp) => ["title", "ctrTitle"].includes(phType(sp)?.type ?? "")) ?? sps.find(hasText);
  const bodySp = sps.find((sp) => sp !== titleSp && (phType(sp)?.type === "body" || phType(sp)?.type === "subTitle" || (phType(sp) && !phType(sp)!.type && phType(sp)!.idx))) ??
    sps.find((sp) => sp !== titleSp && hasText(sp) && !["sldNum", "dt", "ftr"].includes(phType(sp)?.type ?? ""));
  if (!titleSp) throw new Error(`Slide ${e.template} has no text box for a title. Use a different template slide.`);
  xml = xml.replace(titleSp, setBody(titleSp, [{ text: e.title, level: 0 }]));
  const items = (e.bullets ?? []).map((b) => (typeof b === "string" ? { text: b, level: 0 } : { text: b.text, level: b.level ?? 0 }));
  if (bodySp) xml = xml.replace(bodySp, setBody(bodySp, items));
  else if (items.length) throw new Error(`Slide ${e.template} has no text box for the bullets. Use a template slide with a body text box.`);

  const used = Object.keys(deck.zip.files).map((f) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(f)?.[1]).filter(Boolean).map(Number);
  const part = `ppt/slides/slide${Math.max(0, ...used) + 1}.xml`;
  deck.set(part, xml);
  // The rels of the template, but not its notes and not its charts.
  const rels = await deck.rels(t.part);
  const keep = rels.filter((r) => r.type !== "notesSlide" && r.type !== "chart").map((r) => r.tag).join("");
  deck.set(relsPath(part), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${keep}</Relationships>`);
  await deck.addOverride(part, T_SLIDE);
  const rid = await deck.addRel("ppt/presentation.xml", "slide", part);
  const id = String(Math.max(255, ...all.map((o) => Number(o.id))) + 1);
  const tag = `<p:sldId id="${id}" r:id="${rid}"/>`;
  const order = all.map((o) => o.tag);
  order.splice(after, 0, tag);
  await deck.setOrder(order);
  await deck.sectionInsert(id, [...all.slice(0, after).map((o) => o.id), id, ...all.slice(after).map((o) => o.id)]);
  await deck.updateAppCount();
}

// Run the edits and write the file. Returns one line for each edit.
export async function editDeck(path: string, edits: Edit[]): Promise<string[]> {
  const deck = await Deck.open(readFileSync(path));
  const done: string[] = [];
  for (const [i, e] of edits.entries()) {
    const where = `Edit ${i + 1} (${e.op})`;
    try {
      if (e.op === "replace_text") {
        const s = await deck.slide(e.slide);
        const r = replaceInXml(await deck.must(s.part), e.old, e.new, !!e.all);
        if (r.count === 0) throw new Error(`slide ${e.slide} does not have the text "${e.old}". Read the slide with pptx_read and use its exact text.`);
        if (r.count > 1 && !e.all) throw new Error(`slide ${e.slide} has the text "${e.old}" ${r.count} times. Use a longer text, or set all to true.`);
        deck.set(s.part, r.xml);
        done.push(`slide ${e.slide}: replaced ${r.count} time(s)`);
      } else if (e.op === "set_notes") {
        await setNotes(deck, e.slide, e.notes);
        done.push(`slide ${e.slide}: notes set`);
      } else if (e.op === "delete_slide") {
        await deleteSlide(deck, e.slide);
        done.push(`slide ${e.slide}: deleted`);
      } else if (e.op === "move_slide") {
        await moveSlide(deck, e.slide, e.to);
        done.push(`slide ${e.slide}: moved to ${e.to}`);
      } else if (e.op === "add_slide") {
        await addSlide(deck, e);
        done.push(`new slide ${(e.after ?? (await deck.slides()).length - 1) + 1} from slide ${e.template}: "${e.title}"`);
      }
    } catch (err) {
      throw new Error(`${where} failed: ${(err as Error).message} The file did not change.`);
    }
  }
  writeFileSync(path, await deck.zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return done;
}

