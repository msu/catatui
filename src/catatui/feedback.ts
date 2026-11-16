// The feedback client: it makes a report and sends it to the feedback Worker (feedback/ in this repository).
// This file does not import pi, so the desktop app can load it. See src/md/features/feedback.md
// and src/md/infrastructure/feedback.md (the API).

import { readFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { readCredential, type StoredCredential } from "./store.ts";

// The feedback Worker (feedback/, src/md/infrastructure/feedback.md). CATAI_FEEDBACK_URL changes it, for example for a test.
const WORKER_URL = "https://catai-feedback.tight-wave-3e23.workers.dev";
export const FEEDBACK_URL = process.env.CATAI_FEEDBACK_URL || WORKER_URL;

const MB = 1024 * 1024;
// The same limits as the Worker (feedback/src/index.ts).
export const LIMITS = { text: 5000, conversation: MB, screenshot: 4 * MB, contact: 64 };
const TIMEOUT_MS = 30_000;
const NETID = /^[A-Za-z0-9._-]+$/;

const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

export type App = "catai" | "catatui";
export type Kind = "feedback" | "thumbs-down";
export interface Report {
  v: 1; app: App; version: string; os: string; model?: string; kind: Kind; text: string;
  conversation?: string; contact?: string; screenshot?: string;
}

// The report for the Worker. It adds the version and the os, and throws an Error (in STE) if a field is not correct.
// screenshot: a PNG as base64. contact: the NetID; give it only if the student allowed contact.
export function buildReport(r: { app: App; kind: Kind; text: string; conversation?: string; contact?: string; screenshot?: string; model?: string }): Report {
  const text = r.text.trim();
  if (!text) throw new Error("The feedback is empty. Type your feedback, then send it again.");
  if (text.length > LIMITS.text) throw new Error(`The feedback has more than ${LIMITS.text} characters. Make it shorter, then send it again.`);
  if (r.conversation !== undefined && Buffer.byteLength(r.conversation) > LIMITS.conversation)
    throw new Error("The conversation is larger than 1 MB. Do not attach the conversation, then send it again.");
  if (r.contact !== undefined && (r.contact.length > LIMITS.contact || !NETID.test(r.contact)))
    throw new Error("The NetID is not correct. Do not allow contact, then send it again.");
  if (r.screenshot !== undefined && Buffer.from(r.screenshot, "base64").length > LIMITS.screenshot)
    throw new Error("The screenshot is larger than 4 MB. Do not attach the screenshot, then send it again.");
  return {
    v: 1, app: r.app, version: VERSION, os: `${platform()} ${release()} ${arch()}`, kind: r.kind, text,
    ...(r.model ? { model: r.model.slice(0, 128) } : {}),
    ...(r.conversation ? { conversation: r.conversation } : {}),
    ...(r.contact ? { contact: r.contact } : {}),
    ...(r.screenshot ? { screenshot: r.screenshot } : {}),
  };
}

// Send the report. It never throws: it gives { id }, or { error } with what failed, the cause, and the fix.
export async function sendReport(report: Report, url = FEEDBACK_URL): Promise<{ id: string } | { error: string }> {
  const failed = "The feedback did not send";
  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/+$/, "")}/v1/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if ((e as Error).name === "TimeoutError") return { error: `${failed}: the feedback server did not answer in 30 seconds. Try again later.` };
    return { error: `${failed}: the app cannot connect to the feedback server. Check your internet connection, then try again.` };
  }
  let body: { id?: string; error?: string } = {};
  try { body = (await res.json()) as typeof body; } catch { /* the error below uses the status */ }
  if (res.ok && typeof body.id === "string") return { id: body.id };
  if (res.status === 429) return { error: `${failed}: the server got too many reports from your network in one hour. Try again later.` };
  if (res.status === 413) return { error: `${failed}: the report is too large (${body.error ?? "413"}). Do not attach the conversation or the screenshot, then try again.` };
  if (res.status === 400) return { error: `${failed}: the server refused the report (${body.error ?? "400"}). Change the report, then try again.` };
  return { error: `${failed}: the feedback server failed (status ${res.status}). Try again later.` };
}

// The NetID from the CatChat sign-in: the part of the key alias before the first "_". undefined: no sign-in, or not a NetID.
export function netId(cred: StoredCredential | undefined = readCredential()): string | undefined {
  const id = cred?.user?.split("_")[0];
  return id && id.length <= LIMITS.contact && NETID.test(id) ? id : undefined;
}

// The part of a pi message that conversationText reads. The desktop app gives the same shape.
interface Block { type: string; text?: string; name?: string; arguments?: unknown }
interface MessageLike { role: string; content?: string | Block[] }

// The conversation as markdown: the student and assistant text and the tool calls. It leaves out thinking and tool results.
// If it is larger than 1 MB, it keeps the end (the newest part).
export function conversationText(messages: readonly unknown[]): string {
  const parts: string[] = [];
  for (const m of messages as MessageLike[]) {
    if (m?.role !== "user" && m?.role !== "assistant") continue;
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : Array.isArray(m.content) ? m.content : [];
    const out: string[] = [];
    for (const b of blocks) {
      if (b.type === "text" && b.text?.trim()) out.push(b.text.trim());
      else if (b.type === "image") out.push("[image]");
      else if (b.type === "toolCall") out.push(`Tool call: \`${b.name}\`\n\n\`\`\`json\n${JSON.stringify(b.arguments ?? {}, null, 2)}\n\`\`\``);
    }
    if (out.length) parts.push(`## ${m.role === "user" ? "Student" : "Assistant"}\n\n${out.join("\n\n")}`);
  }
  return clipEnd(parts.join("\n\n"), LIMITS.conversation);
}

// Keep the last bytes of s, at most max bytes with the note.
function clipEnd(s: string, max: number): string {
  const buf = Buffer.from(s);
  if (buf.length <= max) return s;
  const note = "[... the start of the conversation is removed, because it is larger than 1 MB ...]\n\n";
  // A cut in a UTF-8 character becomes one U+FFFD (3 bytes), so keep a small margin.
  return note + buf.subarray(buf.length - (max - Buffer.byteLength(note) - 8)).toString("utf8");
}
