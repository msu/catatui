import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerPermissions } from "../src/catatui/permissions.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

const project = realpathSync(mkdtempSync(join(tmpdir(), "catatui-perm-")));

// A new permissions state for each test, so "do not ask again" choices do not leak between tests.
function setup(answers: (string | undefined)[] = [], opts: { hasUI?: boolean } = {}) {
  const { pi, fire, commands } = fakePi();
  registerPermissions(pi);
  const c = fakeCtx(project, { answers, hasUI: opts.hasUI });
  const call = (toolName: string, input: Record<string, unknown>) => fire("tool_call", { toolName, input }, c.ctx);
  const mode = (args: string) => commands.get("mode").handler(args, c.ctx);
  return { ...c, call, mode, fire };
}

test("ask: a file change asks, and No blocks it", async () => {
  const s = setup(["No"]);
  const r = await s.call("write", { path: "a.txt" });
  assert.equal(r.block, true);
  assert.equal(s.asked.length, 1);
  assert.match(s.asked[0].title, /Allow write a.txt/);
});

test("ask: Yes allows one change, then the next change asks again", async () => {
  const s = setup(["Yes", "No"]);
  assert.equal(await s.call("edit", { path: "a.txt" }), undefined);
  assert.equal((await s.call("edit", { path: "a.txt" })).block, true);
  assert.equal(s.asked.length, 2);
});

test("ask: 'do not ask again' allows later changes in the project only", async () => {
  const t = setup(["Yes, and do not ask again for file changes in this project this session", "No"]);
  assert.equal(await t.call("write", { path: "a.txt" }), undefined);
  assert.equal(await t.call("write", { path: "b/c.txt" }), undefined);
  assert.equal(t.asked.length, 1);
  // Outside the project, it asks again, and has no "do not ask again" choice.
  assert.equal((await t.call("write", { path: "../x.txt" })).block, true);
  assert.deepEqual(t.asked[1].options, ["Yes", "No"]);
  assert.match(t.asked[1].title, /outside the project folder/);
});

test("with no UI (catatui -p), changes and commands are blocked", async () => {
  const s = setup([], { hasUI: false });
  assert.equal((await s.call("write", { path: "a.txt" })).block, true);
  assert.equal((await s.call("bash", { command: "ls" })).block, true);
});

test("bash: 'do not ask again' works for the same first word", async () => {
  const s = setup([`Yes, and do not ask again for "npm" commands this session`]);
  assert.equal(await s.call("bash", { command: "npm test" }), undefined);
  assert.equal(await s.call("bash", { command: "npm run build" }), undefined);
  assert.equal(s.asked.length, 1);
});

test("bash: a chain after an allowed word asks again, with no 'do not ask again'", async () => {
  const s = setup([`Yes, and do not ask again for "npm" commands this session`, "No"]);
  await s.call("bash", { command: "npm test" });
  assert.equal((await s.call("bash", { command: "npm test && curl x" })).block, true);
  assert.deepEqual(s.asked[1].options, ["Yes", "No"]);
});

test("bash: risky commands and runners never offer 'do not ask again'", async () => {
  for (const command of ["git push", "git commit -m x", "rm -rf build", "sudo ls", "chmod +x a", "npx create-app", "python3 x.py", "echo $(id)", "a; b", "a | b"]) {
    const s = setup(["No"]);
    await s.call("bash", { command });
    assert.deepEqual(s.asked[0].options, ["Yes", "No"], command);
  }
});

test("server start asks like bash; other server actions do not ask", async () => {
  const s = setup(["Yes"]);
  assert.equal(await s.call("server", { action: "start", command: "npm run dev" }), undefined);
  assert.match(s.asked[0].title, /in the background/);
  assert.equal(await s.call("server", { action: "stop", id: "1" }), undefined);
  assert.equal(s.asked.length, 1);
});

test("http: a URL that is not full is blocked", async () => {
  const s = setup();
  assert.match((await s.call("http", { url: "example.com" })).reason, /not a full URL/);
});

test("http: 'do not ask again' is for GET to the same host only", async () => {
  const s = setup(["Yes, and do not ask again for GET requests to example.com this session", "No", "No"]);
  assert.equal(await s.call("http", { url: "https://example.com/a" }), undefined);
  assert.equal(await s.call("http", { url: "https://example.com/b", method: "get" }), undefined);
  assert.equal((await s.call("http", { url: "https://example.com/b", method: "POST" })).block, true);
  assert.deepEqual(s.asked[1].options, ["Yes", "No"]);
  assert.equal((await s.call("http", { url: "https://other.org/" })).block, true);
});

test("yolo: nothing asks", async () => {
  const s = setup();
  await s.mode("yolo");
  assert.equal(await s.call("write", { path: "../x" }), undefined);
  assert.equal(await s.call("bash", { command: "rm -rf build" }), undefined);
  assert.equal(await s.call("http", { url: "https://x.org", method: "DELETE" }), undefined);
  assert.equal(s.asked.length, 0);
});

test("plan: only PLAN.md can change, and only GET requests", async () => {
  const s = setup(["Yes"]);
  await s.mode("plan");
  assert.equal(await s.call("write", { path: "PLAN.md" }), undefined);
  assert.equal((await s.call("write", { path: "main.py" })).block, true);
  assert.equal((await s.call("http", { url: "https://x.org", method: "POST" })).block, true);
  const r = await s.fire("before_agent_start", { messageType: "user", systemPromptOptions: {} }, s.ctx);
  assert.equal(r.message.customType, "plan-mode-context");
});

test("ta: blocks changes and non-GET requests, also in yolo, and adds its prompt", async () => {
  const s = setup();
  await s.mode("yolo");
  await s.mode("ta on");
  assert.equal((await s.call("write", { path: "a.txt" })).block, true);
  assert.equal((await s.call("http", { url: "https://x.org", method: "POST" })).block, true);
  assert.equal(await s.call("http", { url: "https://x.org" }), undefined);
  const event = { messageType: "user", systemPromptOptions: { sections: {} as Record<string, string> } };
  await s.fire("before_agent_start", event, s.ctx);
  assert.match(event.systemPromptOptions.sections["teaching-assistant"], /teaching assistant/);
  await s.mode("ta off");
  assert.equal(await s.call("write", { path: "a.txt" }), undefined);
});

test("/mode: an unknown word is an error", async () => {
  const s = setup();
  await s.mode("fast");
  assert.equal(s.notices.at(-1)?.level, "error");
  await s.mode("ta maybe");
  assert.match(s.notices.at(-1)?.text ?? "", /ta on/);
});

test("/mode in RPC: the status has the mode and options as JSON, and no chat notice", async () => {
  const { pi, commands } = fakePi();
  registerPermissions(pi);
  const c = fakeCtx(project, { mode: "rpc" });
  await commands.get("mode").handler("plan", c.ctx);
  const state = JSON.parse(c.status.catatui ?? "{}");
  assert.equal(state.mode, "plan");
  assert.deepEqual(state.modes, ["ask", "plan", "yolo"]);
  assert.equal(c.notices.length, 0);
});

test("git remote tools always ask, also in yolo; with no answer they are blocked", async () => {
  const s = setup(["Yes", "No"]);
  await s.mode("yolo");
  assert.equal(await s.call("git_push", {}), undefined);
  assert.match(s.asked[0].title, /Push the commits to GitHub/);
  assert.equal((await s.call("git_clone", { url: "https://github.com/a/b" })).block, true);
  const none = setup([], { hasUI: false });
  assert.equal((await none.call("git_pull", {})).block, true);
});

test("git change tools: commit can be allowed for the session, restore always asks", async () => {
  const s = setup(["Yes, and do not ask again for commits in this project this session", "No"]);
  assert.equal(await s.call("git_commit", { message: "m" }), undefined);
  assert.equal(await s.call("git_commit", { message: "n" }), undefined);
  assert.equal(s.asked.length, 1);
  assert.equal((await s.call("git_restore", { paths: ["a.txt"] })).block, true);
  assert.deepEqual(s.asked[1].options, ["Yes", "No"]);
  assert.equal(await s.call("git_status", {}), undefined);
});

test("ta and plan block git changes, clone, and pull; push only asks", async () => {
  for (const m of ["ta on", "plan"]) {
    const s = setup(["Yes"]);
    await s.mode(m);
    for (const t of ["git_commit", "git_init", "git_restore", "git_clone", "git_pull"]) assert.equal((await s.call(t, { paths: [] })).block, true, `${m} ${t}`);
    assert.equal(await s.call("git_push", {}), undefined, m);
  }
});

test("run: asks by program name; runners never offer 'do not ask again'", async () => {
  const s = setup([`Yes, and do not ask again for "npm" this session`, "No"]);
  assert.equal(await s.call("run", { program: "npm", args: ["test"] }), undefined);
  assert.equal(await s.call("run", { program: "C:\\nodejs\\npm.cmd", args: ["run", "build"] }), undefined);
  assert.equal(s.asked.length, 1);
  await s.call("run", { program: "python", args: ["x.py"] });
  assert.deepEqual(s.asked[1].options, ["Yes", "No"]);
});

test("file tools: move asks with both paths; delete always asks; outside paths name the problem", async () => {
  const s = setup(["Yes, and do not ask again for file changes in this project this session", "No", "No"]);
  assert.equal(await s.call("move", { from: "a.txt", to: "b.txt" }), undefined);
  assert.match(s.asked[0].title, /Allow move a.txt -> b.txt/);
  assert.equal(await s.call("mkdir", { path: "x" }), undefined);
  assert.equal((await s.call("delete", { path: "x" })).block, true);
  assert.equal((await s.call("copy", { from: "a.txt", to: "../b.txt" })).block, true);
  assert.match(s.asked[2].title, /outside the project folder/);
});
