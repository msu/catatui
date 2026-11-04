// Remove sensitive information from a pi session file (JSONL). main.js uses this for "redact-session".
// pi has no API to edit a session, and its "context_edit" entry keeps the old text in the file. So the app
// changes the session file itself: it replaces text and keeps each entry, its id, and its parent (the tree stays).
// No Electron here, so a test can run it in Node.

export const REMOVED = "[removed]";
const KEEP_KEYS = new Set(["type", "id", "parentId", "role", "toolCallId", "targetId", "firstKeptEntryId", "fromId", "provider", "model", "modelId", "api", "stopReason", "timestamp", "name", "path"]);

// Replace each copy of `needle` in the string values of a value (not in the keys above). Returns the count.
export function replaceDeep(v, needle) {
  let count = 0;
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach((x, i) => { if (typeof x === "string") { const n = x.split(needle).length - 1; if (n) { o[i] = x.split(needle).join(REMOVED); count += n; } } else walk(x); }); return; }
    if (!o || typeof o !== "object") return;
    for (const [k, x] of Object.entries(o)) {
      if (KEEP_KEYS.has(k)) continue;
      if (typeof x === "string") { const n = x.split(needle).length - 1; if (n) { o[k] = x.split(needle).join(REMOVED); count += n; } } else walk(x);
    }
  };
  walk(v);
  return count;
}

// Remove one message: its text, thinking, and tool results become "[removed]". Tool call arguments other than
// "path" become "[removed]" too (for example the content of a write).
export function removeMessage(entry, target) {
  const m = entry.type === "message" ? entry.message : undefined;
  if (!m) return 0;
  const blank = (parts) => (Array.isArray(parts) ? parts : [{ type: "text", text: String(parts ?? "") }]).map((p) => {
    if (p.type === "text") return { type: "text", text: REMOVED };
    if (p.type === "thinking") { const { thinkingSignature: _s, ...rest } = p; return { ...rest, thinking: REMOVED }; }
    if (p.type === "image") return { type: "text", text: REMOVED };
    return p;
  });
  if (target.ts !== undefined && m.timestamp === target.ts && (m.role === "user" || m.role === "assistant")) {
    m.content = blank(m.content);
    return 1;
  }
  if (target.toolCallId) {
    if (m.role === "toolResult" && m.toolCallId === target.toolCallId) { m.content = [{ type: "text", text: REMOVED }]; delete m.details; return 1; }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      let n = 0;
      for (const p of m.content) if (p.type === "toolCall" && p.id === target.toolCallId) {
        for (const k of Object.keys(p.arguments ?? {})) if (k !== "path" && typeof p.arguments[k] === "string") { p.arguments[k] = REMOVED; n++; }
      }
      return n ? 1 : 0;
    }
  }
  return 0;
}

// Apply a target to the text of a session file. target: { ts } (a message), { toolCallId } (a tool call and its
// result), or { text } (each copy of the text). Lines that do not change stay byte for byte the same.
export function redactSession(fileText, target) {
  let count = 0;
  const lines = fileText.split("\n").map((line) => {
    if (!line.trim()) return line;
    let entry;
    try { entry = JSON.parse(line); } catch { return line; }
    if (entry.type === "session") return line;
    const n = target?.text ? replaceDeep(entry, target.text) : removeMessage(entry, target ?? {});
    count += n;
    return n ? JSON.stringify(entry) : line;
  });
  return { text: lines.join("\n"), count };
}
