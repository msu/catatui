// Tests for the feedback client (feedback.ts) and /feedback (feedback-command.ts). No real feedback server: a local http server.

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// A temp agent folder, so the tests never read the real ~/.catatui.
process.env.PI_CODING_AGENT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "catatui-feedback-")));
const { buildReport, conversationText, LIMITS, netId, sendReport } = await import("../src/catatui/feedback.ts");
const { registerFeedback } = await import("../src/catatui/feedback-command.ts");
const { fakeCtx, fakePi } = await import("./fake-pi.ts");

const cred = (user?: string) => ({ type: "oauth" as const, access: "k", refresh: "", expires: 0, user });

test("buildReport: version and os, opt-in fields only when given, and the limits", () => {
  const r = buildReport({ app: "catatui", kind: "feedback", text: "  hi  " });
  assert.equal(r.v, 1);
  assert.equal(r.text, "hi");
  assert.match(r.version, /^\d+\.\d+\.\d+/);
  assert.match(r.os, /^\S+ \S+ \S+$/);
  assert.deepEqual(Object.keys(r).sort(), ["app", "kind", "os", "text", "v", "version"]);
  const full = buildReport({ app: "catai", kind: "thumbs-down", text: "x", conversation: "c", contact: "a1b2", screenshot: "iVBORw0KGgo=", model: "m" });
  assert.equal(full.contact, "a1b2");
  assert.equal(full.model, "m");
  assert.throws(() => buildReport({ app: "catatui", kind: "feedback", text: " " }), /empty/);
  assert.throws(() => buildReport({ app: "catatui", kind: "feedback", text: "x".repeat(LIMITS.text + 1) }), /more than 5000/);
  assert.throws(() => buildReport({ app: "catatui", kind: "feedback", text: "x", conversation: "x".repeat(LIMITS.conversation + 1) }), /larger than 1 MB/);
  assert.throws(() => buildReport({ app: "catatui", kind: "feedback", text: "x", contact: "no spaces" }), /NetID/);
  const big = Buffer.alloc(LIMITS.screenshot + 1).toString("base64");
  assert.throws(() => buildReport({ app: "catatui", kind: "feedback", text: "x", screenshot: big }), /4 MB/);
});

test("netId: the part before the first _, or undefined", () => {
  assert.equal(netId(cred("a12b345_catatui_key")), "a12b345");
  assert.equal(netId(cred("a12b345")), "a12b345");
  assert.equal(netId(cred(undefined)), undefined);
  assert.equal(netId(cred("_x")), undefined);
  assert.equal(netId(cred("bad name_x")), undefined);
  assert.equal(netId(undefined), undefined);
  // No sign-in in the temp folder.
  assert.equal(netId(), undefined);
});

test("conversationText: text and tool calls, no thinking and no tool results; clipped at 1 MB from the start", () => {
  const md = conversationText([
    { role: "user", content: "Fix main.py" },
    { role: "assistant", content: [{ type: "thinking", thinking: "SECRET THOUGHT" }, { type: "text", text: "I read it." }, { type: "toolCall", id: "1", name: "read", arguments: { path: "main.py" } }] },
    { role: "toolResult", content: [{ type: "text", text: "TOOL OUTPUT" }] },
    { role: "user", content: [{ type: "text", text: "thanks" }, { type: "image", data: "x", mimeType: "image/png" }] },
  ]);
  assert.match(md, /^## Student\n\nFix main.py\n\n## Assistant\n\nI read it.\n\nTool call: `read`\n\n```json\n\{\n  "path": "main.py"\n\}\n```/);
  assert.match(md, /## Student\n\nthanks\n\n\[image\]$/);
  assert.doesNotMatch(md, /SECRET THOUGHT|TOOL OUTPUT/);
  assert.equal(conversationText([]), "");

  const long = conversationText([{ role: "user", content: "OLD" + "\u00e9".repeat(LIMITS.conversation) }, { role: "assistant", content: [{ type: "text", text: "NEWEST" }] }]);
  assert.ok(Buffer.byteLength(long) <= LIMITS.conversation);
  assert.match(long, /^\[\.\.\. the start of the conversation is removed/);
  assert.match(long, /NEWEST$/);
  assert.doesNotMatch(long, /OLD/);
});

async function server(reply: (req: IncomingMessage, body: string, res: ServerResponse) => void) {
  const s = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d)).on("end", () => reply(req, body, res));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => s.close(r)) };
}

test("sendReport: POST /v1/report gives the id; errors say what failed and the fix", async () => {
  const seen: { method?: string; url?: string; body?: string }[] = [];
  let status = 200;
  const s = await server((req, body, res) => {
    seen.push({ method: req.method, url: req.url, body });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(status === 200 ? { id: "abc" } : { error: "text must be a string" }));
  });
  try {
    const report = buildReport({ app: "catatui", kind: "feedback", text: "hello" });
    assert.deepEqual(await sendReport(report, `${s.url}/`), { id: "abc" });
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].url, "/v1/report");
    assert.equal(JSON.parse(seen[0].body!).text, "hello");
    for (const [code, re] of [[429, /too many reports/], [413, /too large .*Do not attach/], [400, /refused the report \(text must be a string\)/], [500, /status 500/]] as const) {
      status = code;
      const r = await sendReport(report, s.url);
      assert.ok("error" in r);
      assert.match(r.error, /^The feedback did not send: /);
      assert.match(r.error, re);
    }
  } finally {
    await s.close();
  }
  const down = await sendReport(buildReport({ app: "catatui", kind: "feedback", text: "x" }), s.url);
  assert.ok("error" in down);
  assert.match(down.error, /cannot connect to the feedback server\. Check your internet connection/);
});

function run(answers: (string | undefined)[], opts: { conv?: string; netid?: string; hasUI?: boolean } = {}) {
  const sent: any[] = [];
  const { pi, commands } = fakePi();
  registerFeedback(pi, { send: async (r) => (sent.push(r), { id: "r-1" }), conversation: () => opts.conv ?? "", netId: () => opts.netid });
  const f = fakeCtx("/tmp", { answers, hasUI: opts.hasUI });
  return { go: () => commands.get("feedback").handler("", f.ctx), sent, ...f };
}

test("/feedback: asks each question, and sends only what the student allows", async () => {
  const yes = run(["It is slow.", "Yes, attach it", "Yes, send my NetID"], { conv: "## Student\n\nhi", netid: "a1b2" });
  await yes.go();
  assert.equal(yes.sent.length, 1);
  assert.equal(yes.sent[0].text, "It is slow.");
  assert.equal(yes.sent[0].conversation, "## Student\n\nhi");
  assert.equal(yes.sent[0].contact, "a1b2");
  assert.match(yes.asked[0].title, /^Attach this conversation\? \(\d+ bytes\)\n\n  ## Student/);
  assert.match(yes.asked[1].title, /sends your NetID: a1b2/);
  assert.match(yes.notices.at(-1)!.text, /Thank you\. Report r-1 sent\./);

  const no = run(["It is slow.", "No", "No"], { conv: "c", netid: "a1b2" });
  await no.go();
  assert.equal(no.sent[0].conversation, undefined);
  assert.equal(no.sent[0].contact, undefined);

  // No NetID: no contact question. No conversation: no attach question.
  const none = run(["ok"]);
  await none.go();
  assert.equal(none.asked.length, 0);
  assert.equal(none.sent.length, 1);
});

test("/feedback: empty text, Escape, or no UI sends nothing", async () => {
  for (const r of [run([""]), run([undefined]), run(["x", undefined], { conv: "c" }), run(["x", "No", undefined], { conv: "c", netid: "a" }), run(["x"], { hasUI: false })]) {
    await r.go();
    assert.equal(r.sent.length, 0);
  }
});
