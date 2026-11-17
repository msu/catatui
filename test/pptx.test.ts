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

// ---- pptx_edit ----

async function edit(dir: string, path: string, edits: unknown[]) {
  const { pi, tools } = fakePi();
  registerPptxTools(pi);
  return (await tools.get("pptx_edit").execute("1", { path, edits }, undefined, undefined, { cwd: dir })).content[0].text as string;
}

// The package is consistent: each slide in sldIdLst has a rel, a part, and a Content_Types Override; each Override has a part.
async function checkPackage(file: string) {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  const rels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
  const ids = [...pres.matchAll(/<p:sldId id="(\d+)" r:id="(rId\d+)"\/>/g)];
  assert.equal(new Set(ids.map((m) => m[1])).size, ids.length, "slide ids are unique");
  for (const [, , rid] of ids) {
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1];
    assert.ok(target, `rel ${rid}`);
    const part = target!.startsWith("/") ? target!.slice(1) : `ppt/${target}`;
    assert.ok(zip.file(part), `part ${part}`);
    assert.ok(ct.includes(`PartName="/${part}"`), `override ${part}`);
  }
  // Slide and notes Overrides must have a part. (pptxgenjs itself writes Overrides for slide masters that do not exist.)
  for (const m of ct.matchAll(/PartName="\/(ppt\/(?:slides|notesSlides)\/[^"]+)"/g)) assert.ok(zip.file(m[1]), `override has a part: ${m[1]}`);
  return ids.length;
}

test("pptx_edit: replace text keeps the run format, also across runs; errors for 0 or 2 matches", async () => {
  const dir = tmp();
  await writeTestDeck(dir);
  const out = await edit(dir, "deck.pptx", [{ op: "replace_text", slide: 2, old: "Cut costs", new: "Cut all costs & fees" }]);
  assert.match(out, /slide 2: replaced 1 time/);
  const text = await read(dir, "deck.pptx");
  assert.match(text, /## Slide 2: Goals\n- Cut all costs & fees\n/);
  const zip = await JSZip.loadAsync(readFileSync(join(dir, "deck.pptx")));
  assert.match(await zip.file("ppt/slides/slide2.xml")!.async("string"), /sz="2200"[^>]*>[\s\S]*?<a:t>Cut all costs &amp; fees<\/a:t>/);
  await assert.rejects(edit(dir, "deck.pptx", [{ op: "replace_text", slide: 2, old: "nope", new: "x" }]), /does not have the text "nope".*The file did not change/);
  await assert.rejects(edit(dir, "deck.pptx", [{ op: "replace_text", slide: 4, old: "0", new: "x" }]), /3 times/);
  assert.match(await edit(dir, "deck.pptx", [{ op: "replace_text", slide: 4, old: "0", new: "9", all: true }]), /replaced 3 time/);
  assert.match(await read(dir, "deck.pptx"), /Rent\t899\nFood\t259/);
  await checkPackage(join(dir, "deck.pptx"));
});

test("replaceInXml: a match across two runs goes in the first run", async () => {
  const { replaceInXml } = await import("../src/catatui/pptx-edit.ts");
  const xml = '<a:p><a:r><a:rPr b="1"/><a:t>Hel</a:t></a:r><a:r><a:rPr i="1"/><a:t>lo world</a:t></a:r></a:p>';
  const r = replaceInXml(xml, "Hello", "Bye", false);
  assert.equal(r.count, 1);
  assert.equal(r.xml, '<a:p><a:r><a:rPr b="1"/><a:t>Bye</a:t></a:r><a:r><a:rPr i="1"/><a:t> world</a:t></a:r></a:p>');
});

test("pptx_edit: set notes, delete, move, and add a slide; the package stays valid", async () => {
  const dir = tmp();
  await writeTestDeck(dir);
  const file = join(dir, "deck.pptx");
  await edit(dir, "deck.pptx", [
    { op: "set_notes", slide: 3, notes: "New line one\nLine <two>" },
    { op: "delete_slide", slide: 5 },
    { op: "move_slide", slide: 1, to: 5 },
    { op: "add_slide", template: 1, after: 1, title: "Added", bullets: ["Alpha", { text: "Beta", level: 1 }] },
  ]);
  const text = await read(dir, "deck.pptx");
  const titles = [...text.matchAll(/## Slide \d+: (.*)/g)].map((m) => m[1]);
  assert.deepEqual(titles, ["Goals", "Added", "Pros and Cons", "Costs", "Campus", "Budget Review"]);
  assert.match(text, /## Slide 2: Added\n- Alpha\n {2}- Beta\n\n## Slide 3/);
  assert.match(text, /## Slide 3: Pros and Cons\n- Cheap\n- Slow\nNotes: New line one \/ Line <two>/);
  // The copy has no notes and no chart; the deleted chart slide is gone.
  assert.doesNotMatch(text, /Trend|Charts:/);
  assert.equal(await checkPackage(file), 6);
  const zip = await JSZip.loadAsync(readFileSync(file));
  assert.equal(Object.keys(zip.files).filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f)).length, 5);
  const app = await zip.file("docProps/app.xml")!.async("string");
  if (app.includes("<Slides>")) assert.match(app, /<Slides>6<\/Slides>/);
});

test("pptx_edit: a failed edit does not change the file; the last slide cannot be deleted", async () => {
  const dir = tmp();
  await writeTestDeck(dir, "one.pptx", [{ layout: "bullets", title: "Only", bullets: ["x"] }]);
  const before = readFileSync(join(dir, "one.pptx"));
  await assert.rejects(edit(dir, "one.pptx", [{ op: "set_notes", slide: 1, notes: "n" }, { op: "delete_slide", slide: 1 }]), /Edit 2 \(delete_slide\) failed: .*only one slide/);
  assert.deepEqual(readFileSync(join(dir, "one.pptx")), before);
  await assert.rejects(edit(dir, "one.pptx", [{ op: "move_slide", slide: 2, to: 1 }]), /no slide 2/);
});

test("pptx_edit is a change tool", () => {
  assert.ok(CHANGE_TOOLS.includes("pptx_edit"));
});

test("pptx_edit: sections follow a move, a delete, and an added slide", async () => {
  const dir = tmp();
  await writeTestDeck(dir, "s.pptx", DECK.slice(0, 4));
  const file = join(dir, "s.pptx");
  const zip = await JSZip.loadAsync(readFileSync(file));
  let pres = await zip.file("ppt/presentation.xml")!.async("string");
  const ids = [...pres.matchAll(/<p:sldId id="(\d+)"/g)].map((m) => m[1]);
  const sec = (name: string, list: string[]) => `<p14:section name="${name}" id="{0000000${name.length}-0000-0000-0000-000000000000}"><p14:sldIdLst>${list.map((i) => `<p14:sldId id="${i}"/>`).join("")}</p14:sldIdLst></p14:section>`;
  const ext = `<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">${sec("A", ids.slice(0, 2))}${sec("BB", ids.slice(2))}</p14:sectionLst></p:ext></p:extLst>`;
  pres = pres.replace("</p:presentation>", `${ext}</p:presentation>`);
  zip.file("ppt/presentation.xml", pres);
  writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));

  await edit(dir, "s.pptx", [
    { op: "move_slide", slide: 1, to: 4 },
    { op: "delete_slide", slide: 2 },
    { op: "add_slide", template: 1, after: 0, title: "First" },
  ]);
  const out = await (await JSZip.loadAsync(readFileSync(file))).file("ppt/presentation.xml")!.async("string");
  const order = [...(/<p:sldIdLst>([\s\S]*?)<\/p:sldIdLst>/.exec(out)![1]).matchAll(/id="(\d+)"/g)].map((m) => m[1]);
  const inSections = [...(/<p14:sectionLst[\s\S]*<\/p14:sectionLst>/.exec(out)![0]).matchAll(/<p14:sldId id="(\d+)"/g)].map((m) => m[1]);
  // Each slide is in exactly one section, in the same order as the slides.
  assert.deepEqual(inSections, order);
  assert.equal(order.length, 4);
  await checkPackage(file);
});

test("pptx_edit: set_notes makes a notes slide if there is a notes master; without one it refuses", async () => {
  const dir = tmp();
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const make = async (name: string, master: boolean) => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`);
    zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`);
    zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>${master ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>' : ""}</Relationships>`);
    zip.file("ppt/slides/slide1.xml", `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
    if (master) zip.file("ppt/notesMasters/notesMaster1.xml", `<?xml version="1.0"?><p:notesMaster ${NS}><p:cSld><p:spTree/></p:cSld></p:notesMaster>`);
    writeFileSync(join(dir, name), await zip.generateAsync({ type: "nodebuffer" }));
  };
  await make("m.pptx", true);
  await edit(dir, "m.pptx", [{ op: "set_notes", slide: 1, notes: "Fresh note" }]);
  assert.match(await read(dir, "m.pptx"), /## Slide 1: Hi\nNotes: Fresh note/);
  const zip = await JSZip.loadAsync(readFileSync(join(dir, "m.pptx")));
  assert.match(await zip.file("[Content_Types].xml")!.async("string"), /PartName="\/ppt\/notesSlides\/notesSlide1\.xml"/);
  assert.match(await zip.file("ppt/notesSlides/_rels/notesSlide1.xml.rels")!.async("string"), /Target="\.\.\/notesMasters\/notesMaster1\.xml"[\s\S]*Target="\.\.\/slides\/slide1\.xml"/);
  await make("n.pptx", false);
  await assert.rejects(edit(dir, "n.pptx", [{ op: "set_notes", slide: 1, notes: "x" }]), /no notes master/);
});
