// The chat state, built from pi RPC events (pi docs/json.md and docs/rpc-extension-ui.md).
// Pure functions with no React, so a test can run them in Node.
//
// Items:
//   { kind: "user", text }
//   { kind: "assistant", blocks: [{ type: "text" | "thinking", text }], error? }
//   { kind: "tool", id, name, args, result?, isError?, running }
//   { kind: "notice", level: "info" | "warning" | "error", text }

export const initialState = {
  items: [],
  busy: false,
  dialogs: [], // extension_ui_request records that wait for an answer
  widgets: [], // show_widget requests (input dialogs with a "[widget] " title) that wait for an answer
  status: {}, // setStatus entries, by key
  editorText: undefined, // set_editor_text from catatui; the input box takes it once
  queued: [], // messages that the student sent while the agent worked; they wait until it is done
};

const DIALOGS = ["select", "confirm", "input", "editor"];

function userText(content) {
  if (typeof content === "string") return content;
  return (content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

// Text and thinking blocks of an assistant message. Tool calls show as tool items from the tool events.
function blocksOf(message) {
  return (message.content ?? [])
    .filter((c) => c.type === "text" || c.type === "thinking")
    .map((c) => ({ type: c.type, text: c.type === "text" ? c.text : c.thinking ?? c.text ?? "" }));
}

// The index of the last assistant item. Updates go to it.
function lastAssistant(items) {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "assistant") return i;
  return -1;
}

function replaceAt(items, i, item) {
  const next = items.slice();
  next[i] = item;
  return next;
}

export function reduce(state, rec) {
  switch (rec.type) {
    case "agent_start":
      return { ...state, busy: true };
    case "agent_settled":
      return { ...state, busy: false };

    case "message_start": {
      const m = rec.message;
      // ts: the message timestamp. "Remove" uses it to find the message in the session file.
      if (m.role === "user") {
        // A queued message starts now: take it out of the queue.
        const text = userText(m.content);
        const i = state.queued.indexOf(text);
        const queued = i >= 0 ? state.queued.filter((_q, k) => k !== i) : state.queued;
        return { ...state, queued, items: [...state.items, { kind: "user", text, ts: m.timestamp }] };
      }
      if (m.role === "assistant") return { ...state, items: [...state.items, { kind: "assistant", blocks: [], ts: m.timestamp }] };
      return state;
    }

    case "message_update": {
      const ev = rec.assistantMessageEvent;
      const i = lastAssistant(state.items);
      if (i < 0 || !ev) return state;
      const item = state.items[i];
      const blocks = item.blocks.slice();
      const at = ev.contentIndex ?? 0;
      if (ev.type === "text_start" || ev.type === "thinking_start") {
        blocks[at] = { type: ev.type === "text_start" ? "text" : "thinking", text: "" };
      } else if (ev.type === "text_delta" || ev.type === "thinking_delta") {
        const type = ev.type === "text_delta" ? "text" : "thinking";
        const old = blocks[at] ?? { type, text: "" };
        blocks[at] = { ...old, text: old.text + ev.delta };
      } else if (ev.type === "text_end" || ev.type === "thinking_end") {
        const type = ev.type === "text_end" ? "text" : "thinking";
        blocks[at] = { type, text: typeof ev.content === "string" ? ev.content : blocks[at]?.text ?? "" };
      } else {
        return state;
      }
      return { ...state, items: replaceAt(state.items, i, { ...item, blocks }) };
    }

    case "message_end": {
      const m = rec.message;
      if (m.role !== "assistant") return state;
      const i = lastAssistant(state.items);
      if (i < 0) return state;
      const error = m.stopReason === "error" ? m.errorMessage ?? "The model returned an error." : m.stopReason === "aborted" ? "Stopped." : undefined;
      return { ...state, items: replaceAt(state.items, i, { kind: "assistant", blocks: blocksOf(m), error, ts: m.timestamp }) };
    }

    case "tool_execution_start":
      return { ...state, items: [...state.items, { kind: "tool", id: rec.toolCallId, name: rec.toolName, args: rec.args ?? {}, running: true }] };

    case "tool_execution_end": {
      const i = state.items.findIndex((it) => it.kind === "tool" && it.id === rec.toolCallId);
      if (i < 0) return state;
      return { ...state, items: replaceAt(state.items, i, { ...state.items[i], result: rec.result, isError: rec.isError, running: false }) };
    }

    case "extension_error":
      return notice(state, "error", `Extension error (${rec.event}): ${rec.error}`);

    case "extension_ui_request": {
      // A widget: the chat draws it inline from the show_widget tool item, not as a dialog or a notice.
      if (rec.method === "input" && String(rec.title ?? "").startsWith(WIDGET_PREFIX)) return { ...state, widgets: [...state.widgets, rec] };
      // editor_edit (src/catatui/editor.ts): App gives it to the open editor and answers.
      if (rec.method === "input" && String(rec.title ?? "").startsWith(EDITOR_PREFIX)) return { ...state, editorReqs: [...(state.editorReqs ?? []), rec] };
      if (rec.method === "notify" && String(rec.message ?? "").startsWith(WIDGET_PREFIX)) return state;
      // show_preview (preview.ts): the side panel opens the page. No notice in the chat.
      if (rec.method === "notify" && String(rec.message ?? "").startsWith(PREVIEW_PREFIX)) return { ...state, preview: { url: String(rec.message).slice(PREVIEW_PREFIX.length), at: Date.now() } };
      if (DIALOGS.includes(rec.method)) return { ...state, dialogs: [...state.dialogs, rec] };
      if (rec.method === "notify") return notice(state, rec.notifyType ?? "info", rec.message ?? "");
      if (rec.method === "setStatus") {
        const status = { ...state.status };
        if (rec.statusText) status[rec.statusKey] = rec.statusText;
        else delete status[rec.statusKey];
        return { ...state, status };
      }
      if (rec.method === "set_editor_text") return { ...state, editorText: rec.text ?? "" };
      return state;
    }

    default:
      return state;
  }
}

export const notice = (state, level, text) => ({ ...state, items: [...state.items, { kind: "notice", level, text }] });

export const closeDialog = (state, id) => ({ ...state, dialogs: state.dialogs.filter((d) => d.id !== id), widgets: state.widgets.filter((w) => w.id !== id) });

// The same prefix as WIDGET_PREFIX in src/catatui/widget.ts.
export const WIDGET_PREFIX = "[widget] ";
// The same prefix as EDITOR_PREFIX in src/catatui/editor.ts.
export const EDITOR_PREFIX = "[editor] ";
// The same prefix as PREVIEW_PREFIX in src/catatui/preview.ts.
export const PREVIEW_PREFIX = "[preview] ";

// The answer in a show_widget tool result: "The student answered: <JSON>".
export function widgetAnswer(result) {
  const t = resultText(result);
  const m = /^The student answered: ([\s\S]*)$/.exec(t);
  if (!m) return undefined;
  try { return JSON.parse(m[1]); } catch { return m[1]; }
}

// Remove ANSI color codes. catatui notices use the terminal theme colors.
export const plain = (s) => String(s ?? "").replace(/\x1b\[[0-9;]*m/g, "");

// One line that says what a tool call does, for the tool card title. Paths in the project show without the project folder.
export function toolSummary(name, args, project = "") {
  const a = { ...(args ?? {}) };
  if (project && typeof a.path === "string" && a.path.startsWith(`${project}/`)) a.path = a.path.slice(project.length + 1);
  if (a.command) return a.action ? `${a.action}: ${a.command}` : a.command;
  if (a.url) return `${a.method ?? "GET"} ${a.url}`;
  if (a.path) return a.path;
  if (a.pattern) return a.pattern;
  if (a.action) return a.id ? `${a.action} ${a.id}` : a.action;
  if (a.title) return a.title;
  return "";
}

// The text of a tool result.
export function resultText(result) {
  return (result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

// Chat items from saved messages (get_messages), when the student opens an old chat.
// Tool calls are in the assistant messages. Their results are in later "toolResult" messages.
export function itemsFromMessages(messages) {
  const items = [];
  const tools = new Map();
  for (const m of messages ?? []) {
    if (m.role === "user") {
      items.push({ kind: "user", text: userText(m.content), ts: m.timestamp });
    } else if (m.role === "assistant") {
      const blocks = blocksOf(m);
      const error = m.stopReason === "error" ? m.errorMessage ?? "The model returned an error." : m.stopReason === "aborted" ? "Stopped." : undefined;
      if (blocks.length || error) items.push({ kind: "assistant", blocks, error, ts: m.timestamp });
      for (const c of m.content ?? []) {
        if (c.type !== "toolCall") continue;
        const item = { kind: "tool", id: c.id, name: c.name, args: c.arguments ?? {}, running: false };
        tools.set(c.id, item);
        items.push(item);
      }
    } else if (m.role === "toolResult") {
      const item = tools.get(m.toolCallId);
      if (item) Object.assign(item, { result: { content: m.content, details: m.details }, isError: m.isError });
    }
  }
  return items;
}
