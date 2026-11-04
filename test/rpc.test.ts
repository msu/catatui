// Smoke test: start "catatui --mode rpc" with an empty config (no sign-in, no network calls to a model),
// and send RPC commands. This finds a pi update that breaks the start, the extension, or the RPC protocol.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const BIN = new URL("../bin/catatui.js", import.meta.url).pathname;

test("catatui starts in RPC mode and answers commands", { timeout: 60_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "catatui-rpc-")));
  const project = join(root, "project");
  mkdirSync(project);
  const child = spawn(process.execPath, [BIN, "--mode", "rpc"], {
    cwd: project,
    env: { ...process.env, HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "agent"), CATAI: "" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const waiting = new Map<string, (r: any) => void>();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let rec: any;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec.type === "response" && waiting.has(rec.id)) { waiting.get(rec.id)!(rec); waiting.delete(rec.id); }
    }
  });
  let n = 0;
  const send = (cmd: Record<string, unknown>) => new Promise<any>((done, fail) => {
    const id = `t${++n}`;
    waiting.set(id, done);
    child.stdin.write(`${JSON.stringify({ ...cmd, id })}\n`);
    setTimeout(() => fail(new Error(`No answer to ${cmd.type}. stderr:\n${stderr}`)), 30_000).unref();
  });
  try {
    const state = await send({ type: "get_state" });
    assert.equal(state.success, true, JSON.stringify(state));
    assert.equal(state.data.isStreaming, false);

    const cmds = await send({ type: "get_commands" });
    const names = cmds.data.commands.map((c: any) => c.name);
    for (const name of ["catchat", "mode", "undo", "help", "context"]) assert.ok(names.includes(name), `no /${name} in ${names}`);

    // The thinking level commands (the desktop app uses them).
    const levels = await send({ type: "get_available_thinking_levels" });
    assert.equal(levels.success, true, JSON.stringify(levels));
  } finally {
    child.kill();
  }
});
