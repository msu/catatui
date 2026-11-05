import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JUDGE_MODEL, judge, judgeLogFile, judgeState, logJudgment } from "../src/catatui/judge.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "catatui-judge-"));

const input = { tool: "bash", command: "npm test", request: "run the tests", project: "/p", sandbox: true, os: "macOS" };

// A fake fetch that answers with this text, and keeps the request body.
function fake(content: string, status = 200) {
  const bodies: any[] = [];
  const fetchFn = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const json = { choices: [{ message: { content } }] };
    return new Response(status === 200 ? JSON.stringify(json) : "fail", { status });
  }) as unknown as typeof fetch;
  return { fetchFn, bodies };
}

test("judge: only the answer 'allow' allows", async () => {
  for (const [answer, allow] of [["allow", true], ["Allow.", true], ["ask", false], ["allow, but check", false], ["", false]] as const) {
    const f = fake(answer);
    assert.equal((await judge(input, "k", { fetchFn: f.fetchFn })).allow, allow, answer);
  }
});

test("judge: the request has the model, the command, and the student message, and no tool results", async () => {
  const f = fake("allow");
  await judge(input, "k", { fetchFn: f.fetchFn });
  const body = f.bodies[0];
  assert.equal(body.model, JUDGE_MODEL);
  assert.equal(body.temperature, 0);
  assert.match(body.messages[1].content, /Run this bash command: npm test/);
  assert.match(body.messages[1].content, /last message: run the tests/);
  assert.equal(judgeState({ ...input, request: "x".repeat(900) }).includes("x".repeat(501)), false);
});

test("judge: an HTTP error or a timeout gives ask, with an error", async () => {
  const f = fake("allow", 500);
  const r = await judge(input, "k", { fetchFn: f.fetchFn });
  assert.equal(r.allow, false);
  assert.match(r.error ?? "", /HTTP 500/);
  const slow = (async (_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("timeout"))))) as unknown as typeof fetch;
  const t = await judge(input, "k", { fetchFn: slow, timeoutMs: 20 });
  assert.equal(t.allow, false);
  assert.ok(t.error);
});

test("logJudgment: one JSON line for each decision", () => {
  logJudgment(input, { allow: true, answer: "allow", ms: 5 });
  const line = JSON.parse(readFileSync(judgeLogFile(), "utf8").trim().split("\n").at(-1) ?? "{}");
  assert.equal(line.command, "npm test");
  assert.equal(line.allow, true);
});
