// New files from the desktop tree menu: names, titles, and start content.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDocx, checkHtml } from "../src/catatui/a11y.ts";
import { newFileContent, newFileName, newKind, titleOf } from "../src/catatui/newfile.ts";

test("newFileName adds the extension and removes unsafe characters", () => {
  assert.equal(newFileName("my page", newKind("html")!), "my page.html");
  assert.equal(newFileName("notes.md", newKind("md")!), "notes.md");
  assert.equal(newFileName("../x/y", newKind("js")!), "x y.js");
  assert.equal(newFileName("  ", newKind("md")!), undefined);
  assert.equal(newFileName("Lab 3", newKind("folder")!), "Lab 3");
  assert.equal(titleOf("budget-plan.xlsx"), "Budget plan");
});

test("new HTML and Word files pass the accessibility check", async () => {
  const html = checkHtml(String(await newFileContent("html", "home.html")));
  assert.equal(html.findings.filter((f) => f.level === "error").length, 0);
  const docx = await checkDocx(await newFileContent("docx", "report.docx") as Buffer);
  assert.equal(docx.findings.filter((f) => f.level === "error").length, 0);
  const xlsx = await newFileContent("xlsx", "budget.xlsx");
  assert.ok(Buffer.isBuffer(xlsx) && xlsx.length > 0);
});

test("movedNote names the old and the new paths", async () => {
  const { movedNote } = await import("../src/catatui/moved.ts");
  assert.match(movedNote([{ from: "home.html", to: "Lab 1/home.html" }]), /home\.html -> Lab 1\/home\.html/);
});

test("withCurrentAgents changes, adds, and removes AGENTS.md in the context files", async () => {
  const { withCurrentAgents } = await import("../src/catatui/agentsfile.ts");
  const files = [{ path: "/home/AGENTS.md", content: "global" }, { path: "/p/AGENTS.md", content: "old" }];
  assert.deepEqual(withCurrentAgents(files, "/p/AGENTS.md", "new"), [{ path: "/home/AGENTS.md", content: "global" }, { path: "/p/AGENTS.md", content: "new" }]);
  assert.deepEqual(withCurrentAgents(files, "/p/AGENTS.md", undefined), [{ path: "/home/AGENTS.md", content: "global" }]);
  assert.deepEqual(withCurrentAgents([], "/p/AGENTS.md", "x"), [{ path: "/p/AGENTS.md", content: "x" }]);
});

test("addedNote names the copied paths", async () => {
  const { addedNote } = await import("../src/catatui/moved.ts");
  assert.match(addedNote(["data.csv", "pics"]), /data\.csv; pics/);
});

test("editorSection names the open file, the line, the selection, and editor_edit", async () => {
  const { editorSection } = await import("../src/catatui/editor.ts");
  const s = editorSection({ path: "index.html", line: 6, selection: "<h1>Hi</h1>" });
  assert.match(s, /index\.html open in the catai editor, with the cursor on line 6/);
  assert.match(s, /<h1>Hi<\/h1>/);
  assert.match(s, /use editor_edit/);
});

test("deletedNote names the deleted paths", async () => {
  const { deletedNote } = await import("../src/catatui/moved.ts");
  assert.match(deletedNote(["old.html"]), /deleted old\.html \(moved to the Trash\)/);
});
