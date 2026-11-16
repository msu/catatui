// The feedback Worker: students send feedback from catai and catatui. The reports are for the course staff only.
// See src/md/infrastructure/feedback.md.
// handle() is a pure function of the request and the bindings, so the tests run it in Node with fake DB and SHOTS objects.

// The parts of the D1 and R2 bindings that handle() uses.
export interface Statement {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface Env {
  DB: { prepare(sql: string): Statement };
  SHOTS: { put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown> };
  IP_SALT?: string;
}

const MB = 1024 * 1024;
export const LIMITS = {
  text: 5000, // characters
  conversation: MB, // bytes (UTF-8)
  error: 64 * 1024, // bytes (UTF-8): the message, the stack trace, and the last lines of the catatui stderr
  screenshot: 4 * MB, // bytes, after base64 decode
  body: 7 * MB, // bytes: the conversation, the base64 screenshot (4/3 of 4 MB), and the other fields
  contact: 64,
  short: 128, // version, os, model
  perHour: 10, // reports from one IP address
};
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const APPS = ["catai", "catatui"];
const KINDS = ["feedback", "thumbs-down", "error"];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A field that is not correct: the status (400 or 413) and the message.
class Bad extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function shortString(body: Record<string, unknown>, name: string, optional = false): string | undefined {
  const v = body[name];
  if (v === undefined && optional) return undefined;
  if (typeof v !== "string" || !v) throw new Bad(400, `${name} must be a string that is not empty`);
  if (v.length > LIMITS.short) throw new Bad(400, `${name} has more than ${LIMITS.short} characters`);
  return v;
}

function oneOf(body: Record<string, unknown>, name: string, values: string[]): string {
  const v = body[name];
  if (typeof v !== "string" || !values.includes(v)) throw new Bad(400, `${name} must be one of: ${values.join(", ")}`);
  return v;
}

function decodePng(s: unknown): Uint8Array {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Bad(400, "screenshot must be base64");
  if (Math.floor((s.length * 3) / 4) > LIMITS.screenshot + 2) throw new Bad(413, "screenshot is larger than 4 MB");
  let bin: string;
  try {
    bin = atob(s);
  } catch {
    throw new Bad(400, "screenshot must be base64");
  }
  if (bin.length > LIMITS.screenshot) throw new Bad(413, "screenshot is larger than 4 MB");
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (!PNG.every((b, i) => bytes[i] === b)) throw new Bad(400, "screenshot must be a PNG image");
  return bytes;
}

// The checked report. It throws Bad for a field that is not correct.
function parse(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Bad(400, "the body must be a JSON object");
  const b = body as Record<string, unknown>;
  if (b.v !== 1) throw new Bad(400, "v must be 1");
  const app = oneOf(b, "app", APPS);
  const kind = oneOf(b, "kind", KINDS);
  const version = shortString(b, "version")!;
  const os = shortString(b, "os")!;
  const model = shortString(b, "model", true);
  // An error report can have empty text: the student does not have to type.
  if (typeof b.text !== "string") throw new Bad(400, "text must be a string");
  if (kind !== "error" && !b.text.trim()) throw new Bad(400, "text must be a string that is not empty");
  if (b.text.length > LIMITS.text) throw new Bad(413, `text has more than ${LIMITS.text} characters`);
  let error: string | undefined;
  if (b.error !== undefined) {
    if (typeof b.error !== "string") throw new Bad(400, "error must be a string");
    if (new TextEncoder().encode(b.error).length > LIMITS.error) throw new Bad(413, "error is larger than 64 KB");
    error = b.error;
  }
  if (kind === "error" && !error?.trim()) throw new Bad(400, "error is necessary for the kind error");
  let conversation: string | undefined;
  if (b.conversation !== undefined) {
    if (typeof b.conversation !== "string") throw new Bad(400, "conversation must be a string");
    if (new TextEncoder().encode(b.conversation).length > LIMITS.conversation) throw new Bad(413, "conversation is larger than 1 MB");
    conversation = b.conversation;
  }
  let netid: string | undefined;
  if (b.contact !== undefined) {
    if (typeof b.contact !== "string" || b.contact.length > LIMITS.contact || !/^[A-Za-z0-9._-]+$/.test(b.contact))
      throw new Bad(400, "contact must be a NetID: at most 64 characters, only A-Z, a-z, 0-9, '.', '_' and '-'");
    netid = b.contact;
  }
  const screenshot = b.screenshot === undefined ? undefined : decodePng(b.screenshot);
  return { app, kind, version, os, model, text: b.text, error, conversation, netid, screenshot };
}

async function ipHash(ip: string, salt: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/v1/report") return json(404, { error: "not found" });
  if (!env.IP_SALT) return json(500, { error: "the server has no IP_SALT. Run: wrangler secret put IP_SALT" });

  // Rate limit. The table keeps a hash of the IP address, not the address.
  const hash = await ipHash(request.headers.get("CF-Connecting-IP") ?? "unknown", env.IP_SALT);
  await env.DB.prepare("DELETE FROM hits WHERE at < ?").bind(now - DAY).run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM hits WHERE ip_hash = ? AND at > ?").bind(hash, now - HOUR).first<{ n: number }>();
  if ((count?.n ?? 0) >= LIMITS.perHour) return json(429, { error: `more than ${LIMITS.perHour} reports in one hour. Try again later.` });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LIMITS.body) return json(413, { error: "the report is larger than 7 MB" });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > LIMITS.body) return json(413, { error: "the report is larger than 7 MB" });

  let report;
  try {
    report = parse(JSON.parse(raw));
  } catch (e) {
    if (e instanceof Bad) return json(e.status, { error: e.message });
    return json(400, { error: "the body is not JSON" });
  }

  const id = crypto.randomUUID();
  let key: string | null = null;
  if (report.screenshot) {
    key = `screenshots/${id}.png`;
    await env.SHOTS.put(key, report.screenshot, { httpMetadata: { contentType: "image/png" } });
  }
  await env.DB.prepare(
    "INSERT INTO reports (id, created, app, version, os, model, kind, text, error, conversation, netid, screenshot_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, new Date(now).toISOString(), report.app, report.version, report.os, report.model ?? null, report.kind, report.text, report.error ?? null,
      report.conversation ?? null, report.netid ?? null, key)
    .run();
  await env.DB.prepare("INSERT INTO hits (ip_hash, at) VALUES (?, ?)").bind(hash, now).run();
  return json(200, { id });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error(e);
      return json(500, { error: "the server failed to save the report. Try again later." });
    }
  },
};
