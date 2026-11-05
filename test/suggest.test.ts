// Suggestions in the terminal message box (suggest-editor.ts), and the shared setting (settings.ts).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { saveCredential } from "../src/catatui/store.ts";
import { settingsFile, writeSetting } from "../src/catatui/settings.ts";
import { SuggestEditor } from "../src/catatui/suggest-editor.ts";
import { suggestOn, wantsSuggestion } from "../src/catatui/suggest.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "catatui-suggest-"));
saveCredential({ access: "key", expires: Date.now() + 86_400_000 });

const theme: any = { borderColor: (s: string) => s, selectList: { selectedPrefix: (s: string) => s, selectedText: (s: string) => s, description: (s: string) => s, scrollInfo: (s: string) => s, noMatch: (s: string) => s } };
const keys: any = { matches: () => false };

function editor(answer = " the tests") {
  let renders = 0;
  const tui: any = { terminal: { rows: 40, columns: 80 }, requestRender: () => { renders++; } };
  const asked: string[] = [];
  const e = new SuggestEditor(tui, theme, keys, (s) => `<${s}>`, () => "context", async (text) => { asked.push(text); return answer; });
  return { e, asked, renders: () => renders };
}

const type = (e: SuggestEditor, text: string) => { for (const ch of text) e.handleInput(ch); e.render(60); };
const shown = (e: SuggestEditor) => stripTerminalSequences(e.render(60).join("\n"));

test("wantsSuggestion: 3 or more characters, not /commands or !shell", () => {
  assert.equal(wantsSuggestion("ab"), false);
  assert.equal(wantsSuggestion("/mode yolo"), false);
  assert.equal(wantsSuggestion("!ls -la"), false);
  assert.equal(wantsSuggestion("run"), true);
});

test("the suggestion shows after a pause, Tab accepts it, and Escape hides it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { e, asked } = editor();
  type(e, "run");
  assert.deepEqual(asked, []);
  t.mock.timers.tick(450);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(asked, ["run"]);
  assert.equal(e.hint, " the tests");
  assert.match(shown(e), /run.<? the tests>?.*tab/);
  e.handleInput("\t");
  assert.equal(e.getText(), "run the tests");

  const b = editor();
  type(b.e, "fix");
  t.mock.timers.tick(450);
  await new Promise((r) => setImmediate(r));
  b.e.handleInput("\x1b");
  assert.equal(b.e.hint, "");
  assert.equal(b.e.getText(), "fix");
});

test("a new key removes the suggestion; no request when the setting is off", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { e } = editor();
  type(e, "run");
  t.mock.timers.tick(450);
  await new Promise((r) => setImmediate(r));
  type(e, "s");
  assert.equal(e.hint, "");

  writeSetting("suggest", false);
  assert.equal(suggestOn(), false);
  const off = editor();
  type(off.e, "run");
  t.mock.timers.tick(450);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(off.asked, []);
  writeSetting("suggest", true);
});

test("writeSetting keeps the other keys", () => {
  writeSetting("ste", false);
  writeSetting("idleCompaction", { enabled: false, minutes: 5, percent: 40 });
  const data = JSON.parse(readFileSync(settingsFile(), "utf8"));
  assert.equal(data.ste, false);
  assert.equal(data.idleCompaction.minutes, 5);
});
