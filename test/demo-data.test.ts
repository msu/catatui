// The JSON files for the phone app demo (mobile/assets/demo/) must agree with the desktop demo data
// (src/catatui/profile.ts, advising.ts, classes.ts). scripts/demo-data.ts writes the files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { DEMO_DIR, demoFiles } from "../scripts/demo-data.ts";
import { registerAdvising } from "../src/catatui/advising.ts";
import { CLASSES, registerClasses } from "../src/catatui/classes.ts";
import { PROFILE } from "../src/catatui/profile.ts";
import { fakePi } from "./fake-pi.ts";

const read = (name: string) => JSON.parse(readFileSync(join(DEMO_DIR, name), "utf8"));

// Run a desktop tool. Its result is a "MOCK DATA" line and then JSON. Return the line and the parsed JSON.
async function run(tools: Map<string, any>, name: string, params: Record<string, unknown> = {}) {
  const text: string = (await tools.get(name).execute("id", params)).content[0].text;
  const nl = text.indexOf("\n");
  return { note: text.slice(0, nl), data: JSON.parse(text.slice(nl + 1)) };
}

test("demo data: the JSON files are the same as the output of scripts/demo-data.ts", () => {
  for (const [name, body] of Object.entries(demoFiles())) {
    assert.equal(readFileSync(join(DEMO_DIR, name), "utf8"), body, `${name} is old. Run: node scripts/demo-data.ts`);
  }
});

test("demo data: profile.json has the mock student of profile.ts", () => {
  const p = read("profile.json");
  assert.match(p.mock_note, /^MOCK DATA/);
  for (const [k, v] of Object.entries(PROFILE)) assert.deepEqual(p[k], v, k);
  assert.equal(p.full_name, "Alex Rivera");
  assert.equal(p.balance_total, 5120.5);
});

test("demo data: advising.json agrees with the desktop advising tools", async () => {
  const { pi, tools } = fakePi();
  registerAdvising(pi);
  const a = read("advising.json");
  const transcript = await run(tools, "advising_transcript");
  assert.equal(a.mock_note, transcript.note);
  assert.deepEqual(a.transcript, transcript.data);
  assert.deepEqual(a.requirements, (await run(tools, "advising_requirements")).data);
  assert.deepEqual(a.next_term, (await run(tools, "advising_classes")).data);
  // Spot checks, so that a mistake in the tools and in the script together does not pass.
  assert.equal(a.next_term.term, "Spring 2027");
  assert.equal(a.next_term.classes.find((c: any) => c.course === "CSCI 476").full, true);
  assert.equal(a.course_titles["CSCI 468"], "Compilers");
});

test("demo data: classes.json agrees with the desktop classes tools", async () => {
  const { pi, tools } = fakePi();
  registerClasses(pi);
  const c = read("classes.json");
  const overview = await run(tools, "classes_overview");
  assert.equal(c.mock_note, overview.note);
  assert.deepEqual(c.overview, overview.data);
  assert.deepEqual(c.deadlines, (await run(tools, "classes_deadlines")).data);
  assert.deepEqual(c.classes.map((x: any) => x.code), CLASSES.map((x) => x.code));
  for (const x of c.classes) {
    const course = { course: x.code };
    assert.deepEqual(x.syllabus, (await run(tools, "class_syllabus", course)).data, x.code);
    assert.deepEqual(x.assignments, (await run(tools, "class_assignments", course)).data, x.code);
    assert.deepEqual(x.grades, (await run(tools, "class_grades", course)).data, x.code);
    assert.deepEqual(x.materials, (await run(tools, "class_materials", course)).data.materials, x.code);
  }
  assert.equal(c.overview.today, "2026-11-03");
});
