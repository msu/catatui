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
