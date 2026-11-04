import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain JavaScript module of the desktop app
import { closeDialog, initialState, itemsFromMessages, plain, reduce, toolSummary, widgetAnswer } from "../desktop/src/chat.js";

const run = (records: any[], state: any = initialState) => records.reduce(reduce, state);

test("a streamed answer with thinking and text", () => {
  const s = run([
    { type: "agent_start" },
    { type: "message_start", message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } },
    { type: "message_start", message: { role: "assistant", content: [], timestamp: 2 } },
    { type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
    { type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "hm" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Hel" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "lo" } },
  ]);
  assert.equal(s.busy, true);
  assert.deepEqual(s.items[0], { kind: "user", text: "hi", ts: 1 });
  assert.deepEqual(s.items[1].blocks, [{ type: "thinking", text: "hm" }, { type: "text", text: "Hello" }]);
  const done = run([
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "Hello!" }], timestamp: 2 } },
    { type: "agent_settled" },
  ], s);
  assert.equal(done.busy, false);
  assert.deepEqual(done.items[1], { kind: "assistant", blocks: [{ type: "text", text: "Hello!" }], error: undefined, ts: 2 });
});

test("an error and a stop show on the assistant item", () => {
  const start = { type: "message_start", message: { role: "assistant", content: [] } };
  const err = run([start, { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "500" } }]);
  assert.equal(err.items[0].error, "500");
  const stop = run([start, { type: "message_end", message: { role: "assistant", content: [], stopReason: "aborted" } }]);
  assert.equal(stop.items[0].error, "Stopped.");
});

test("tool start and end update one tool item", () => {
  const s = run([
    { type: "tool_execution_start", toolCallId: "t", toolName: "read", args: { path: "a" } },
    { type: "tool_execution_end", toolCallId: "t", result: { content: [{ type: "text", text: "x" }] }, isError: false },
  ]);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].running, false);
  assert.equal(s.items[0].result.content[0].text, "x");
});

test("a queued message leaves the queue when it starts", () => {
  const s = run([{ type: "message_start", message: { role: "user", content: "b", timestamp: 5 } }], { ...initialState, queued: ["a", "b", "b"] });
  assert.deepEqual(s.queued, ["a", "b"]);
  assert.equal(s.items[0].text, "b");
});

test("extension UI: widgets, previews, dialogs, notices, status, editor text", () => {
  const s = run([
    { type: "extension_ui_request", id: "w", method: "input", title: '[widget] {"type":"quiz"}' },
    { type: "extension_ui_request", id: "n", method: "notify", message: "[widget] {}" },
    { type: "extension_ui_request", id: "p", method: "notify", message: "[preview] http://localhost:5173/" },
    { type: "extension_ui_request", id: "d", method: "select", title: "Allow?", options: ["Yes", "No"] },
    { type: "extension_ui_request", id: "i", method: "notify", message: "Saved", notifyType: "warning" },
    { type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "mode", statusText: "ask" },
    { type: "extension_ui_request", id: "s2", method: "setStatus", statusKey: "ta", statusText: "on" },
    { type: "extension_ui_request", id: "s3", method: "setStatus", statusKey: "ta" },
    { type: "extension_ui_request", id: "e", method: "set_editor_text", text: "/login catchat" },
  ]);
  assert.deepEqual(s.widgets.map((w: any) => w.id), ["w"]);
  assert.equal(s.preview.url, "http://localhost:5173/");
  assert.deepEqual(s.dialogs.map((d: any) => d.id), ["d"]);
  assert.deepEqual(s.items, [{ kind: "notice", level: "warning", text: "Saved" }]);
  assert.deepEqual(s.status, { mode: "ask" });
  assert.equal(s.editorText, "/login catchat");
  const closed = closeDialog(closeDialog(s, "d"), "w");
  assert.equal(closed.dialogs.length + closed.widgets.length, 0);
});

test("itemsFromMessages joins tool calls and their results", () => {
  const items = itemsFromMessages([
    { role: "user", content: "go", timestamp: 1 },
    { role: "assistant", timestamp: 2, content: [{ type: "text", text: "ok" }, { type: "toolCall", id: "t", name: "bash", arguments: { command: "ls" } }] },
    { role: "toolResult", toolCallId: "t", content: [{ type: "text", text: "a.txt" }], isError: false },
    { role: "assistant", timestamp: 3, content: [], stopReason: "aborted" },
  ]);
  assert.deepEqual(items.map((i: any) => i.kind), ["user", "assistant", "tool", "assistant"]);
  assert.equal(items[2].result.content[0].text, "a.txt");
  assert.equal(items[3].error, "Stopped.");
});

test("widgetAnswer, toolSummary, plain", () => {
  assert.deepEqual(widgetAnswer({ content: [{ type: "text", text: 'The student answered: {"a":1}' }] }), { a: 1 });
  assert.equal(widgetAnswer({ content: [{ type: "text", text: "The student answered: B" }] }), "B");
  assert.equal(widgetAnswer({ content: [{ type: "text", text: "other" }] }), undefined);
  assert.equal(toolSummary("read", { path: "/p/src/a.py" }, "/p"), "src/a.py");
  assert.equal(toolSummary("server", { action: "start", command: "npm run dev" }), "start: npm run dev");
  assert.equal(toolSummary("http", { url: "https://x.org" }), "GET https://x.org");
  assert.equal(plain("\x1b[33mwarn\x1b[0m"), "warn");
});
