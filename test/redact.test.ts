import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain JavaScript module of the desktop app
import { REMOVED, redactSession } from "../desktop/redact.js";

const PIN = "4417";
const entries = [
  { type: "session", version: 3, id: "s", cwd: `/home/${PIN}` },
  { type: "message", id: "1", parentId: null, message: { role: "user", content: [{ type: "text", text: `My PIN is ${PIN}.` }], timestamp: 100 } },
  { type: "message", id: "2", parentId: "1", message: {
    role: "assistant", timestamp: 200, provider: "catchat", model: "Qwen",
    content: [
      { type: "thinking", thinking: `The PIN is ${PIN}.`, thinkingSignature: "sig" },
      { type: "text", text: `I saved ${PIN}.` },
      { type: "toolCall", id: "t1", name: "write", arguments: { path: `notes-${PIN}.txt`, content: `PIN ${PIN}` } },
    ],
  } },
  { type: "message", id: "3", parentId: "2", message: { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: `Wrote PIN ${PIN}` }], details: { diff: PIN }, timestamp: 300 } },
  { type: "message", id: "4", parentId: "3", message: { role: "user", content: "Thanks", timestamp: 400 } },
];
const file = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
const parse = (text: string) => text.split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("text: replaces each copy, and keeps ids, parents, paths, and the session header", () => {
  const { text, count } = redactSession(file, { text: PIN });
  assert.equal(count, 6);
  const out = parse(text);
  assert.equal(text.split("\n")[0], file.split("\n")[0]);
  assert.deepEqual(out.map((e) => [e.id, e.parentId]), entries.map((e: any) => [e.id, e.parentId]));
  assert.equal(out[1].message.content[0].text, `My PIN is ${REMOVED}.`);
  assert.equal(out[2].message.content[2].arguments.path, `notes-${PIN}.txt`);
  assert.equal(out[3].message.details.diff, REMOVED);
  assert.equal(text.split("\n").slice(1).join("\n").includes(`PIN ${PIN}`), false);
});

test("text: unchanged lines stay byte for byte the same", () => {
  const { text } = redactSession(file, { text: PIN });
  assert.equal(text.split("\n")[4], file.split("\n")[4]);
  assert.equal(text.endsWith("\n"), true);
});

test("text: no match gives count 0", () => {
  assert.equal(redactSession(file, { text: "not there" }).count, 0);
});

test("a message by timestamp: user text becomes [removed]", () => {
  const out = parse(redactSession(file, { ts: 100 }).text);
  assert.deepEqual(out[1].message.content, [{ type: "text", text: REMOVED }]);
  assert.equal(out[2].message.content[1].text, `I saved ${PIN}.`);
});

test("a message by timestamp: a string content works too", () => {
  const out = parse(redactSession(file, { ts: 400 }).text);
  assert.deepEqual(out[4].message.content, [{ type: "text", text: REMOVED }]);
});

test("an assistant message: thinking and text go, the signature goes, tool calls stay", () => {
  const out = parse(redactSession(file, { ts: 200 }).text);
  const [thinking, text, call] = out[2].message.content;
  assert.deepEqual(thinking, { type: "thinking", thinking: REMOVED });
  assert.equal(text.text, REMOVED);
  assert.equal(call.arguments.content, `PIN ${PIN}`);
});

test("a tool call: the result and the arguments go, the path stays", () => {
  const { text, count } = redactSession(file, { toolCallId: "t1" });
  assert.equal(count, 2);
  const out = parse(text);
  assert.deepEqual(out[2].message.content[2].arguments, { path: `notes-${PIN}.txt`, content: REMOVED });
  assert.deepEqual(out[3].message.content, [{ type: "text", text: REMOVED }]);
  assert.equal(out[3].message.details, undefined);
});

test("a bad line stays as it is", () => {
  const { text, count } = redactSession(`not json ${PIN}\n${file}`, { text: PIN });
  assert.equal(text.split("\n")[0], `not json ${PIN}`);
  assert.equal(count, 6);
});
