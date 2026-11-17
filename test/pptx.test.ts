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
