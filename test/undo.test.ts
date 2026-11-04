import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerUndo } from "../src/catatui/undo.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

function setup(answers: string[] = []) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "catatui-undo-")));
  const { pi, fire, commands } = fakePi();
  registerUndo(pi);
  const c = fakeCtx(dir, { answers, mode: "rpc" });
  // One agent run: the tool calls, then the file changes that the tools make.
  const run = async (prompt: string, changes: Record<string, string>) => {
    await fire("before_agent_start", { messageType: "user", prompt }, c.ctx);
    for (const path of Object.keys(changes)) await fire("tool_call", { toolName: "write", input: { path } }, c.ctx);
    for (const [path, text] of Object.entries(changes)) writeFileSync(join(dir, path), text);
    await fire("agent_end", {}, c.ctx);
  };
  const undo = () => commands.get("undo").handler("", c.ctx);
  return { dir, fire, run, undo, ...c };
}

test("undo puts back a changed file and deletes a new file", async () => {
  const s = setup(["Yes"]);
  writeFileSync(join(s.dir, "a.txt"), "old");
  await s.run("change a, add b", { "a.txt": "new", "b.txt": "b" });
  assert.equal(s.status["catatui-undo"], "1");
  await s.undo();
  assert.equal(readFileSync(join(s.dir, "a.txt"), "utf8"), "old");
  assert.equal(existsSync(join(s.dir, "b.txt")), false);
  assert.equal(s.status["catatui-undo"], "0");
  assert.match(s.asked[0].title, /delete \(new\): b.txt/);
});

test("each request is one step, newest first", async () => {
  const s = setup(["Yes", "Yes"]);
  writeFileSync(join(s.dir, "a.txt"), "1");
  await s.run("first", { "a.txt": "2" });
  await s.run("second", { "a.txt": "3" });
  await s.undo();
  assert.equal(readFileSync(join(s.dir, "a.txt"), "utf8"), "2");
  await s.undo();
  assert.equal(readFileSync(join(s.dir, "a.txt"), "utf8"), "1");
});

test("a request with no file change is not a step", async () => {
  const s = setup();
  writeFileSync(join(s.dir, "a.txt"), "same");
  await s.run("no change", { "a.txt": "same" });
  await s.undo();
  assert.match(s.notices.at(-1)?.text ?? "", /nothing to undo/);
});

test("No keeps the files", async () => {
  const s = setup(["No"]);
  writeFileSync(join(s.dir, "a.txt"), "old");
  await s.run("change", { "a.txt": "new" });
  await s.undo();
  assert.equal(readFileSync(join(s.dir, "a.txt"), "utf8"), "new");
});

test("the question warns when the student changed the file after the agent", async () => {
  const s = setup(["Yes"]);
  writeFileSync(join(s.dir, "a.txt"), "old");
  await s.run("change", { "a.txt": "agent" });
  writeFileSync(join(s.dir, "a.txt"), "student");
  await s.undo();
  assert.match(s.asked[0].title, /your changes will be lost/);
});

test("the next request tells the model about the undo", async () => {
  const s = setup(["Yes"]);
  await s.run("add", { "a.txt": "x" });
  await s.undo();
  const r = await s.fire("before_agent_start", { messageType: "user", prompt: "next" }, s.ctx);
  assert.equal(r.message.customType, "undo-note");
  assert.match(r.message.content, /before the request "add"/);
  // Only once.
  assert.equal(await s.fire("before_agent_start", { messageType: "user", prompt: "again" }, s.ctx), undefined);
});
