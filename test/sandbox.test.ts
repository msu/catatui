import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { registerSandbox, sandboxOn, setSandbox } from "../src/catatui/sandbox.ts";
import { fakeCtx, fakePi } from "./fake-pi.ts";

// The real path, like process.cwd() in pi. On macOS, tmpdir() is a symbolic link (/var -> /private/var).
const root = realpathSync(mkdtempSync(join(tmpdir(), "catatui-sandbox-")));
const project = join(root, "project");
mkdirSync(project);
writeFileSync(join(root, "secret.txt"), "x");
symlinkSync(join(root, "secret.txt"), join(project, "link.txt"));

const { pi, fire } = fakePi({ "no-sandbox": false });
registerSandbox(pi);
const { ctx } = fakeCtx(project, { hasUI: false });
await fire("session_start", {}, ctx);

const call = (toolName: string, input: Record<string, unknown>) => fire("tool_call", { toolName, input }, ctx);
const blocked = async (toolName: string, input: Record<string, unknown>) => (await call(toolName, input))?.block === true;

test("file tools: paths in the project are allowed", async () => {
  assert.equal(await blocked("read", { path: "src/a.py" }), false);
  assert.equal(await blocked("write", { path: join(project, "b.txt") }), false);
  assert.equal(await blocked("ls", {}), false);
  assert.equal(await blocked("read", { path: "@notes.md" }), false);
});

test("file tools: paths outside the project are blocked", async () => {
  assert.equal(await blocked("read", { path: "/etc/passwd" }), true);
  assert.equal(await blocked("read", { path: "../secret.txt" }), true);
  assert.equal(await blocked("edit", { path: "~/.bashrc" }), true);
  assert.equal(await blocked("write", { path: join(root, "x") }), true);
});

test("file tools: a symbolic link to a file outside the project is blocked", async () => {
  assert.equal(await blocked("read", { path: "link.txt" }), true);
});

test("file tools: a new file in a linked folder outside the project is blocked", async () => {
  mkdirSync(join(root, "outside"), { recursive: true });
  symlinkSync(join(root, "outside"), join(project, "linkdir"));
  assert.equal(await blocked("write", { path: "linkdir/new.txt" }), true);
  assert.equal(await blocked("write", { path: "linkdir/a/b/new.txt" }), true);
});

test("a project path with a symbolic link in it: new files are allowed", async () => {
  const linked = join(root, "linked-project");
  symlinkSync(project, linked);
  const r = await fire("tool_call", { toolName: "write", input: { path: "new/file.txt" } }, fakeCtx(linked, { hasUI: false }).ctx);
  assert.equal(r, undefined);
});

test("shell: commands with paths outside the project are blocked", async () => {
  for (const command of ["cat /etc/passwd", "cd .. && ls", "ls ~", "cat $HOME/.ssh/id_rsa", "cp a.txt ${HOME}/b", "echo x > /tmp/y"]) {
    assert.equal(await blocked("bash", { command }), true, command);
  }
  assert.equal(await blocked("server", { action: "start", command: "python3 -m http.server -d /" }), true);
});

test("shell: commands in the project are allowed", async () => {
  for (const command of ["npm test", "python3 main.py", "ls -la src", "node x.js > /dev/null 2>&1", "git status"]) {
    assert.equal(await blocked("bash", { command }), false, command);
  }
  assert.equal(await blocked("server", { action: "stop", id: "1" }), false);
});

test("the block reason names the path and the fix", async () => {
  const r = await call("read", { path: "/etc/passwd" });
  assert.match(r.reason, /\/etc\/passwd is outside the project folder/);
  assert.match(r.reason, /--no-sandbox/);
});

test("with the sandbox off, nothing is blocked", async () => {
  setSandbox(ctx as any, false);
  try {
    assert.equal(sandboxOn(), false);
    assert.equal(await blocked("read", { path: "/etc/passwd" }), false);
    assert.equal(await blocked("bash", { command: "cat /etc/passwd" }), false);
  } finally {
    setSandbox(ctx as any, true);
  }
});

test("move and copy: both paths are checked", async () => {
  assert.equal(await blocked("move", { from: "a.txt", to: "../a.txt" }), true);
  assert.equal(await blocked("copy", { from: "/etc/passwd", to: "p.txt" }), true);
  assert.equal(await blocked("move", { from: "a.txt", to: "b/a.txt" }), false);
});

test("git tools: paths and the clone folder are checked", async () => {
  assert.equal(await blocked("git_restore", { paths: ["a.txt", "../x"] }), true);
  assert.equal(await blocked("git_clone", { url: "https://github.com/a/b", folder: "~/b" }), true);
  assert.equal(await blocked("git_diff", { path: "src" }), false);
});

test("run: the program and each argument are checked", async () => {
  assert.equal(await blocked("run", { program: "python3", args: ["main.py", "--out=build/x"] }), false);
  assert.equal(await blocked("run", { program: "cat", args: ["/etc/passwd"] }), true);
  assert.equal(await blocked("run", { program: "python3", args: ["src/../../x.py"] }), true);
  assert.equal(await blocked("run", { program: "node", args: ["--out=../x"] }), true);
  assert.equal(await blocked("run", { program: "/usr/bin/python3", args: [] }), true);
  assert.equal(await blocked("run", { program: "curl", args: ["https://example.com/a/b"] }), false);
});
