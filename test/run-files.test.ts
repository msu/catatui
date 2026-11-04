// run.ts, files.ts, and /undo for the file tools.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerFileTools } from "../src/catatui/files.ts";
import { blockedReason, programName, registerRun } from "../src/catatui/run.ts";
import { registerUndo } from "../src/catatui/undo.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "catatui-rf-")));
const NODE = process.execPath;

function runTool(cwd: string) {
  const { pi, tools } = fakePi();
  registerRun(pi);
  return async (params: Record<string, unknown>, signal?: AbortSignal) =>
    (await tools.get("run").execute("id", params, signal, undefined, fakeCtx(cwd).ctx)).content[0].text as string;
}

test("run: output, exit code, stdin, and no shell", async () => {
  const dir = tmp();
  const run = runTool(dir);
  assert.equal(await run({ program: NODE, args: ["-e", "console.log(process.cwd())"] }), `Exit code 0.\n${dir}`);
  assert.match(await run({ program: NODE, args: ["-e", "process.exit(3)"] }), /^Exit code 3\./);
  assert.match(await run({ program: NODE, args: ["-e", "process.stdin.pipe(process.stdout)"], input: "hello" }), /hello/);
  // No shell: "&&" and "$HOME" are plain arguments.
  assert.match(await run({ program: NODE, args: ["-e", "console.log(process.argv.slice(1).join('|'))", "a && b", "$HOME"] }), /a && b\|\$HOME/);
});

test("run: a missing program, a timeout, and a stop", async () => {
  const run = runTool(tmp());
  assert.match(await run({ program: "no-such-program-catatui" }), /not installed/);
  assert.match(await run({ program: NODE, args: ["-e", "setTimeout(()=>{}, 60000)"], timeout: 1 }), /Stopped after 1 seconds/);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  assert.match(await run({ program: NODE, args: ["-e", "setTimeout(()=>{}, 60000)"] }, ac.signal), /^Stopped\./);
});

test("run: long output keeps the end", async () => {
  const out = await runTool(tmp())({ program: NODE, args: ["-e", "for (let i = 0; i < 20000; i++) console.log('line ' + i)"] });
  assert.match(out, /characters before this/);
  assert.match(out, /line 19999$/);
});

test("run: blocked programs", async () => {
  for (const p of ["ssh", "scp", "git", "bash", "C:\\Windows\\System32\\cmd.exe", "/usr/bin/ssh", "pwsh"]) assert.ok(blockedReason(p), p);
  for (const p of ["python", "npm", "node", "javac"]) assert.equal(blockedReason(p), undefined, p);
  assert.equal(programName("C:\\x\\npm.CMD"), "npm");
  assert.match(await runTool(tmp())({ program: "git", args: ["status"] }), /^Blocked: git\. Use the git_ tools/);
});

function fileTools(cwd: string) {
  const { pi, tools } = fakePi();
  registerFileTools(pi);
  return async (name: string, params: Record<string, unknown>) => (await tools.get(name).execute("id", params, undefined, undefined, fakeCtx(cwd).ctx)).content[0].text as string;
}

test("file tools: move, copy, delete, mkdir", async () => {
  const dir = tmp();
  const t = fileTools(dir);
  writeFileSync(join(dir, "a.txt"), "a");
  assert.match(await t("mkdir", { path: "src/lib" }), /Made the folder/);
  assert.ok(existsSync(join(dir, "src/lib")));
  assert.match(await t("copy", { from: "a.txt", to: "src/b.txt" }), /Copied/);
  assert.match(await t("copy", { from: "a.txt", to: "src/b.txt" }), /exists/);
  assert.match(await t("move", { from: "src", to: "lib2" }), /Moved/);
  assert.equal(readFileSync(join(dir, "lib2/b.txt"), "utf8"), "a");
  assert.match(await t("move", { from: "lib2", to: "lib2/inner" }), /cannot move into itself/);
  assert.match(await t("delete", { path: "lib2" }), /Deleted the folder/);
  assert.match(await t("delete", { path: "." }), /does not delete the project folder/);
  assert.match(await t("delete", { path: "none" }), /There is no file/);
});

test("undo: puts back a deleted folder and a moved file, and removes a new folder", async () => {
  const dir = tmp();
  const { pi, fire, commands, tools } = fakePi();
  registerFileTools(pi);
  registerUndo(pi);
  const c = fakeCtx(dir, { answers: ["Yes"], mode: "rpc" });
  mkdirSync(join(dir, "docs/sub"), { recursive: true });
  writeFileSync(join(dir, "docs/sub/x.md"), "x");
  writeFileSync(join(dir, "a.txt"), "a");
  await fire("before_agent_start", { messageType: "user", prompt: "clean up" }, c.ctx);
  const call = async (toolName: string, input: Record<string, unknown>) => {
    await fire("tool_call", { toolName, input }, c.ctx);
    await tools.get(toolName).execute("id", input, undefined, undefined, c.ctx);
  };
  await call("delete", { path: "docs" });
  await call("move", { from: "a.txt", to: "b.txt" });
  await call("mkdir", { path: "new/deep" });
  await fire("agent_end", {}, c.ctx);
  assert.equal(c.status["catatui-undo"], "1");
  await commands.get("undo").handler("", c.ctx);
  assert.equal(readFileSync(join(dir, "docs/sub/x.md"), "utf8"), "x");
  assert.equal(readFileSync(join(dir, "a.txt"), "utf8"), "a");
  assert.equal(existsSync(join(dir, "b.txt")), false);
  assert.equal(existsSync(join(dir, "new")), false);
});
