// Tests for the feedback Worker. They run handle() in Node with fake DB and SHOTS objects, with no Cloudflare packages.

import assert from "node:assert/strict";
import { test } from "node:test";
import { handle, LIMITS, type Env } from "../src/index.ts";

// A fake D1 that knows only the SQL that handle() sends.
function fakeEnv() {
  const reports: Record<string, unknown>[] = [];
  let hits: { ip_hash: string; at: number }[] = [];
  const shots = new Map<string, { value: Uint8Array; type?: string }>();
  const env: Env = {
    IP_SALT: "salt",
    DB: {
      prepare(sql: string) {
        let args: unknown[] = [];
        const st = {
          bind(...a: unknown[]) { args = a; return st; },
          async run() {
            if (sql.startsWith("DELETE FROM hits")) hits = hits.filter((h) => h.at >= (args[0] as number));
            else if (sql.startsWith("INSERT INTO hits")) hits.push({ ip_hash: args[0] as string, at: args[1] as number });
            else if (sql.startsWith("INSERT INTO reports")) {
              const cols = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(", ");
              reports.push(Object.fromEntries(cols.map((c, i) => [c, args[i]])));
            } else throw new Error(`fake DB: unknown SQL ${sql}`);
            return {};
          },
          async first<T>() {
            if (!sql.startsWith("SELECT COUNT(*) AS n FROM hits")) throw new Error(`fake DB: unknown SQL ${sql}`);
            return { n: hits.filter((h) => h.ip_hash === args[0] && h.at > (args[1] as number)).length } as T;
          },
        };
        return st;
      },
    },
    SHOTS: { async put(key, value, options) { shots.set(key, { value, type: options?.httpMetadata?.contentType }); return {}; } },
  };
  return { env, reports, shots, hits: () => hits };
}

const good = { v: 1, app: "catatui", version: "0.7.1", os: "darwin 25.0.0 arm64", kind: "feedback", text: "The diff is too small." };
const post = (body: unknown, ip = "10.0.0.1", path = "/v1/report") =>
  new Request(`https://feedback.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest")]);

test("a good report: 200 with an id, one row, no opt-in fields, and no plain IP", async () => {
  const f = fakeEnv();
  const res = await handle(post(good), f.env);
  assert.equal(res.status, 200);
  const { id } = await res.json();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(f.reports.length, 1);
  const r = f.reports[0];
  assert.equal(r.id, id);
  assert.equal(r.app, "catatui");
  assert.equal(r.conversation, null);
  assert.equal(r.netid, null);
  assert.equal(r.screenshot_key, null);
  assert.equal(r.model, null);
  assert.equal(f.shots.size, 0);
  assert.equal(f.hits().length, 1);
  assert.match(f.hits()[0].ip_hash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(f.hits()), /10\.0\.0\.1/);
});

test("each opt-in field: model, conversation, contact, screenshot in R2", async () => {
  const f = fakeEnv();
  const body = { ...good, kind: "thumbs-down", model: "gpt-oss", conversation: "## User\nhi", contact: "a12b345", screenshot: png.toString("base64") };
  const res = await handle(post(body), f.env);
  assert.equal(res.status, 200);
  const { id } = await res.json();
  const r = f.reports[0];
  assert.equal(r.kind, "thumbs-down");
  assert.equal(r.model, "gpt-oss");
  assert.equal(r.conversation, "## User\nhi");
  assert.equal(r.netid, "a12b345");
  assert.equal(r.screenshot_key, `screenshots/${id}.png`);
  const shot = f.shots.get(`screenshots/${id}.png`);
  assert.equal(shot?.type, "image/png");
  assert.deepEqual(Buffer.from(shot!.value), png);
});

test("a bad field: 400 with an error, and nothing saved", async () => {
  const cases: unknown[] = [
    "not json",
    [1],
    { ...good, v: 2 },
    { ...good, app: "other" },
    { ...good, kind: "praise" },
    { ...good, version: "" },
    { ...good, text: "  " },
    { ...good, contact: "bad netid" },
    { ...good, contact: "x".repeat(65) },
    { ...good, conversation: 5 },
    { ...good, screenshot: "not base64!" },
    { ...good, screenshot: Buffer.from("GIF89a").toString("base64") },
  ];
  for (const body of cases) {
    const f = fakeEnv();
    const res = await handle(post(body), f.env);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok((await res.json()).error);
    assert.equal(f.reports.length, 0);
    assert.equal(f.hits().length, 0);
  }
});

test("too large: 413 for text, conversation, screenshot, and the body", async () => {
  const big = Buffer.concat([png, Buffer.alloc(LIMITS.screenshot)]).toString("base64");
  const cases: unknown[] = [
    { ...good, text: "x".repeat(LIMITS.text + 1) },
    { ...good, conversation: "x".repeat(LIMITS.conversation + 1) },
    { ...good, screenshot: big },
    { ...good, conversation: "x".repeat(LIMITS.body) },
  ];
  for (const body of cases) {
    const f = fakeEnv();
    const res = await handle(post(body), f.env);
    assert.equal(res.status, 413);
    assert.equal(f.reports.length, 0);
  }
  // A text of exactly 5000 characters is accepted.
  assert.equal((await handle(post({ ...good, text: "x".repeat(LIMITS.text) }), fakeEnv().env)).status, 200);
});

test("the rate limit: 10 reports per IP per hour; old hits are deleted", async () => {
  const f = fakeEnv();
  const t0 = Date.UTC(2026, 10, 16);
  for (let i = 0; i < 10; i++) assert.equal((await handle(post(good), f.env, t0 + i)).status, 200);
  assert.equal((await handle(post(good), f.env, t0 + 10)).status, 429);
  // Another IP is not limited.
  assert.equal((await handle(post(good, "10.0.0.2"), f.env, t0 + 11)).status, 200);
  // After one hour, the first IP can send again.
  assert.equal((await handle(post(good), f.env, t0 + 60 * 60 * 1000 + 1)).status, 200);
  // After one day, the old hits are gone.
  await handle(post(good, "10.0.0.3"), f.env, t0 + 26 * 60 * 60 * 1000);
  assert.equal(f.hits().length, 1);
});

test("a wrong path or method: 404", async () => {
  const f = fakeEnv();
  assert.equal((await handle(post(good, "10.0.0.1", "/v1/other"), f.env)).status, 404);
  assert.equal((await handle(post(good, "10.0.0.1", "/"), f.env)).status, 404);
  assert.equal((await handle(new Request("https://feedback.example/v1/report"), f.env)).status, 404);
  assert.equal(f.reports.length, 0);
});

test("no IP_SALT: 500 with the fix", async () => {
  const f = fakeEnv();
  f.env.IP_SALT = undefined;
  const res = await handle(post(good), f.env);
  assert.equal(res.status, 500);
  assert.match((await res.json()).error, /wrangler secret put IP_SALT/);
});

test("error reports: kind error needs the error field; the text can be empty; 64 KB limit", async () => {
  const f = fakeEnv();
  const trace = "TypeError: x is undefined\n    at run (~/app/main.js:10:5)";
  const res = await handle(post({ ...good, kind: "error", text: "", error: trace }), f.env);
  assert.equal(res.status, 200);
  assert.equal(f.reports[0].kind, "error");
  assert.equal(f.reports[0].text, "");
  assert.equal(f.reports[0].error, trace);
  // Other kinds have no error column value unless they send one.
  await handle(post(good), f.env);
  assert.equal(f.reports[1].error, null);

  for (const [body, status, re] of [
    [{ ...good, kind: "error", text: "" }, 400, /error is necessary/],
    [{ ...good, kind: "error", text: "it broke" }, 400, /error is necessary/],
    [{ ...good, kind: "error", text: "", error: "  " }, 400, /error is necessary/],
    [{ ...good, kind: "error", text: "", error: 5 }, 400, /error must be a string/],
    [{ ...good, kind: "error", text: "", error: "x".repeat(LIMITS.error + 1) }, 413, /64 KB/],
    [{ ...good, text: "" }, 400, /not empty/],
  ] as const) {
    const g = fakeEnv();
    const r = await handle(post(body), g.env);
    assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
    assert.match((await r.json()).error, re);
    assert.equal(g.reports.length, 0);
  }
  // Exactly 64 KB is accepted.
  assert.equal((await handle(post({ ...good, kind: "error", text: "", error: "x".repeat(LIMITS.error) }), fakeEnv().env)).status, 200);
});
