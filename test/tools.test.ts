// Which tools load where, and the mock data tools (classes, advising).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerAdvising } from "../src/catatui/advising.ts";
import { CLASSES, grade, registerClasses, summaries, TERM, upcoming } from "../src/catatui/classes.ts";
import catatui from "../src/catatui/index.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

const APP_TOOLS = ["new_project", "show_widget", "show_preview", "open_view"];

async function toolsWith(env: Record<string, string>) {
  const keys = ["CATAI", "CATATUI_ADVISING", "CATATUI_CLASSES", "CATATUI_CLASS"];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try {
    const { pi, tools } = fakePi();
    await catatui(pi);
    return [...tools.keys()];
  } finally {
    for (const k of keys) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k];
  }
}

test("the CLI does not load the app-only tools", async () => {
  const tools = await toolsWith({});
  for (const t of APP_TOOLS) assert.equal(tools.includes(t), false, t);
  assert.ok(tools.includes("http"));
  assert.equal(tools.some((t) => t.startsWith("advising_") || t.startsWith("class")), false);
});

test("CATAI=1 loads the app-only tools", async () => {
  const tools = await toolsWith({ CATAI: "1" });
  for (const t of APP_TOOLS) assert.ok(tools.includes(t), t);
});

test("the area variables load the advising and classes tools", async () => {
  assert.ok((await toolsWith({ CATATUI_ADVISING: "1" })).includes("advising_submit_plan"));
  assert.ok((await toolsWith({ CATATUI_CLASSES: "1" })).includes("classes_deadlines"));
  const one = await toolsWith({ CATATUI_CLASS: "CSCI 305" });
  assert.ok(one.includes("class_assignments"));
  assert.equal(one.includes("classes_deadlines"), false);
});

test("grade: weights only the categories with grades", () => {
  const c = {
    ...CLASSES[0],
    weights: { Homework: 50, Exams: 50 },
    assignments: [
      { name: "a", category: "Homework", due: "2026-01-01", points: 10, score: 9, status: "graded" },
      { name: "b", category: "Homework", due: "2026-01-02", points: 10, score: 7, status: "graded" },
      { name: "c", category: "Exams", due: "2026-12-01", points: 100, status: "open" },
    ],
  } as any;
  const g = grade(c);
  assert.equal(g.percent, 80);
  assert.equal(g.letter, "B-");
  assert.equal(grade({ ...c, assignments: [] }).percent, undefined);
});

test("upcoming: open work in the window and late work, soonest first", () => {
  const { today, work } = upcoming(7);
  assert.equal(today, TERM.today);
  assert.ok(work.length > 0);
  assert.deepEqual(work.map((w) => w.due), work.map((w) => w.due).sort());
  for (const w of work) assert.ok(w.status === "late" || (w.in_days >= 0 && w.in_days <= 7), w.name);
  assert.ok(work.some((w) => w.status === "late"));
});

test("summaries: one row for each class, with a grade", () => {
  const s = summaries();
  assert.equal(s.length, CLASSES.length);
  for (const row of s) assert.equal(typeof row.grade, "number", row.code);
});

test("class tools: any spacing and case works; an unknown course is an error in the overview only", async () => {
  const exec = async (course: string | undefined, params: any) => {
    const { pi, tools } = fakePi();
    registerClasses(pi, course);
    return (await tools.get("class_assignments").execute("id", params)).content[0].text as string;
  };
  assert.match(await exec(undefined, { course: "csci305" }), /"course": "CSCI 305"/);
  assert.match(await exec(undefined, { course: "XYZ 1" }), /^Unknown course "XYZ 1"/);
  assert.match(await exec(undefined, {}), /^Unknown course ""/);
  // In a class chat, the class is the default.
  assert.match(await exec("M 221", {}), /"course": "M 221"/);
});

test("advising: the transcript has a GPA, and the requirements have a status", async () => {
  const { pi, tools } = fakePi();
  registerAdvising(pi);
  const data = async (name: string) => JSON.parse((await tools.get(name).execute("id", {})).content[0].text.split("\n").slice(1).join("\n"));
  const t = await data("advising_transcript");
  assert.ok(t.gpa > 0 && t.gpa <= 4);
  const r = await data("advising_requirements");
  const reqs = r.requirements ?? r;
  assert.ok(Array.isArray(reqs) && reqs.every((x: any) => ["complete", "in progress", "needed"].includes(x.status)));
});

test("advising_submit_plan: No saves nothing; Send saves a copy with warnings", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "catatui-advising-")));
  const { pi, tools } = fakePi();
  registerAdvising(pi);
  const params = { terms: [{ term: "Spring 2027", courses: ["CSCI 476", "CSCI 127"] }] };
  const no = await tools.get("advising_submit_plan").execute("id", params, undefined, undefined, fakeCtx(dir, { answers: ["No"] }).ctx);
  assert.match(no.content[0].text, /did not send/);
  assert.equal(existsSync(join(dir, "Submitted plans")), false);
  const rpc = fakeCtx(dir, { mode: "rpc", answers: ['{"send":true}'] }).ctx;
  const yes = await tools.get("advising_submit_plan").execute("id", params, undefined, undefined, rpc);
  const out = JSON.parse(yes.content[0].text.split("\n").slice(1).join("\n"));
  assert.equal(out.submitted, true);
  assert.ok(existsSync(out.saved_copy));
  assert.ok(out.warnings.includes("CSCI 476 is full in Spring 2027."));
  assert.ok(out.warnings.includes("CSCI 127 is already complete."));
});
