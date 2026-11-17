// PowerPoint: pptx_write makes a deck. The test opens the zip and checks the slides, the text, and the notes.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import JSZip from "jszip";
import { registerPptxTools } from "../src/catatui/pptx.ts";
import { CHANGE_TOOLS } from "../src/catatui/config.ts";
import { fakePi } from "./fake-pi.ts";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "catatui-pptx-")));
// A 1 x 1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

export const DECK = [
  { layout: "title", title: "Budget Review", subtitle: "BMGT 205", notes: "Welcome everyone." },
  { layout: "bullets", title: "Goals", bullets: ["Cut costs", { text: "Rent", level: 1 }, "Save more"], notes: "Say the goals." },
  { layout: "two-columns", title: "Pros and Cons", bullets: ["Cheap"], right: ["Slow"] },
  { layout: "table", title: "Costs", table: [["Item", "Cost"], ["Rent", "800"], ["Food", "250"]] },
  { layout: "chart", title: "Trend", chart: { type: "bar", labels: ["Jan", "Feb"], series: [{ name: "Cost", values: [1050, 990] }] } },
  { layout: "image", title: "Campus", image: "pic.png", bullets: ["The new building"] },
];

export async function writeTestDeck(dir: string, path = "deck.pptx", slides: unknown[] = DECK, theme?: string) {
  writeFileSync(join(dir, "pic.png"), PNG);
  const { pi, tools } = fakePi();
  registerPptxTools(pi);
  return tools.get("pptx_write").execute("1", { path, slides, theme }, undefined, undefined, { cwd: dir });
}

const slideFiles = (zip: JSZip, prefix: string) =>
  Object.keys(zip.files).filter((f) => new RegExp(`^${prefix}\\d+\\.xml$`).test(f)).sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]));

test("pptx_write: the slides, the titles, the notes, the MSU footer, an image, a table, and a chart", async () => {
  const dir = tmp();
  const r = await writeTestDeck(dir);
  assert.match(r.content[0].text, /Wrote deck\.pptx: 6 slides \(theme msu\)/);
  const zip = await JSZip.loadAsync(readFileSync(join(dir, "deck.pptx")));
  const slides = slideFiles(zip, "ppt/slides/slide");
  assert.equal(slides.length, 6);
  const xml = await Promise.all(slides.map((f) => zip.file(f)!.async("string")));
  assert.match(xml[0], /Budget Review/);
  assert.match(xml[1], /Goals/);
  assert.match(xml[1], /Rent/);
  assert.match(xml[3], /<a:tbl>/);
  assert.match(xml[5], /<p:pic>/);
  assert.ok(Object.keys(zip.files).some((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)));
  const notes = await Promise.all(slideFiles(zip, "ppt/notesSlides/notesSlide").map((f) => zip.file(f)!.async("string")));
  assert.ok(notes.some((n) => n.includes("Welcome everyone.")));
  assert.ok(notes.some((n) => n.includes("Say the goals.")));
  const layouts = await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/slideLayouts\/.*\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")));
  assert.ok(layouts.some((l) => l.includes("Montana State University")));
});

test("pptx_write: theme plain has no MSU footer; it replaces the file", async () => {
  const dir = tmp();
  await writeTestDeck(dir, "d.pptx");
  await writeTestDeck(dir, "d.pptx", [{ layout: "bullets", title: "Only one", bullets: ["x"] }], "plain");
  const zip = await JSZip.loadAsync(readFileSync(join(dir, "d.pptx")));
  assert.equal(slideFiles(zip, "ppt/slides/slide").length, 1);
  const all = await Promise.all(Object.keys(zip.files).filter((f) => f.endsWith(".xml")).map((f) => zip.file(f)!.async("string")));
  assert.ok(!all.some((x) => x.includes("Montana State University")));
});

test("pptx_write: an image outside the project or a missing image is refused", async () => {
  const dir = tmp();
  await assert.rejects(writeTestDeck(dir, "a.pptx", [{ layout: "image", title: "x", image: "/etc/hosts" }]), /not in the project folder/);
  await assert.rejects(writeTestDeck(dir, "a.pptx", [{ layout: "image", title: "x", image: "nope.png" }]), /does not exist/);
  await assert.rejects(writeTestDeck(dir, "a.pptx", [{ layout: "table", title: "x" }]), /no table rows/);
  writeFileSync(join(dir, "fake.png"), "not an image");
  await assert.rejects(writeTestDeck(dir, "a.pptx", [{ layout: "image", title: "x", image: "fake.png" }]), /not a PNG, JPEG, or GIF image/);
});

test("pptx_write is a change tool", () => {
  assert.ok(CHANGE_TOOLS.includes("pptx_write"));
});

async function read(dir: string, path: string) {
  const { pi, tools } = fakePi();
  registerPptxTools(pi);
  return (await tools.get("pptx_read").execute("1", { path }, undefined, undefined, { cwd: dir })).content[0].text as string;
}

test("pptx_read: the pptx_write deck in order, with titles, levels, the table, the image, the chart, and the notes", async () => {
  const dir = tmp();
  await writeTestDeck(dir);
  const text = await read(dir, "deck.pptx");
  assert.match(text, /^6 slides\n\n## Slide 1: Budget Review\n- BMGT 205\nNotes: Welcome everyone\./);
  assert.match(text, /## Slide 2: Goals\n- Cut costs\n {2}- Rent\n- Save more\nNotes: Say the goals\./);
  assert.match(text, /## Slide 3: Pros and Cons\n- Cheap\n- Slow/);
  assert.match(text, /## Slide 4: Costs\nTable:\nItem\tCost\nRent\t800\nFood\t250/);
  assert.match(text, /## Slide 5: Trend\nCharts: 1/);
  assert.match(text, /## Slide 6: Campus\n- The new building\nImages: Campus/);
  // The footer and the slide number are in the master, not on the slides.
  assert.doesNotMatch(text, /Montana State University/);
});

test("pptx_read: a deck with title placeholders, entities, a hidden slide, and the slide order from presentation.xml", async () => {
  const dir = tmp();
  const zip = new JSZip();
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const sp = (ph: string, paras: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paras}</p:txBody></p:sp>`;
  const slide = (body: string, extra = "") => `<?xml version="1.0"?><p:sld ${NS}${extra}><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="257" r:id="rId9"/><p:sldId id="256" r:id="rId8"/></p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`);
  zip.file("ppt/slides/slide1.xml", slide(sp('<p:ph type="title"/>', "<a:p><a:r><a:t>Q&amp;A</a:t></a:r></a:p>") + sp('<p:ph idx="1"/>', '<a:p><a:r><a:t>Ask &lt;anything&gt;</a:t></a:r></a:p><a:p><a:pPr lvl="2"/><a:r><a:t>deep</a:t></a:r></a:p>'), ' show="0"'));
  zip.file("ppt/slides/slide2.xml", slide(sp('<p:ph type="ctrTitle"/>', "<a:p><a:r><a:t>First</a:t></a:r></a:p>")));
  zip.file("ppt/slides/_rels/slide1.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`);
  zip.file("ppt/notesSlides/notesSlide1.xml", `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree>${sp('<p:ph type="sldImg"/>', "")}${sp('<p:ph type="body" idx="1"/>', "<a:p><a:r><a:t>Line one</a:t></a:r></a:p><a:p><a:r><a:t>Line &#x2013; two</a:t></a:r></a:p>")}</p:spTree></p:cSld></p:notes>`);
  writeFileSync(join(dir, "made.pptx"), await zip.generateAsync({ type: "nodebuffer" }));
  const text = await read(dir, "made.pptx");
  assert.equal(text, "2 slides\n\n## Slide 1: First\n\n## Slide 2 (hidden): Q&A\n- Ask <anything>\n    - deep\nNotes: Line one / Line \u2013 two");
});

test("pptx_read: not a deck gives a clear error; pptx_read is a read tool", async () => {
  const dir = tmp();
  const zip = new JSZip();
  zip.file("word/document.xml", "<x/>");
  writeFileSync(join(dir, "doc.pptx"), await zip.generateAsync({ type: "nodebuffer" }));
  await assert.rejects(read(dir, "doc.pptx"), /not a PowerPoint \.pptx file/);
  const { READ_TOOLS } = await import("../src/catatui/config.ts");
  assert.ok(READ_TOOLS.includes("pptx_read"));
});

