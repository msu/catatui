// Excel: the grid of a workbook for the desktop side panel (excelGrid).
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { excelGrid } from "../src/catatui/excel.ts";

test("excelGrid gives the values, the formulas, and the sheets", async () => {
  const path = join(realpathSync(mkdtempSync(join(tmpdir(), "catatui-excel-"))), "budget.xlsx");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget");
  ws.addRow(["Item", "Cost"]);
  ws.getRow(1).font = { bold: true };
  ws.addRow(["Rent", 800]);
  ws.addRow(["Food", 250]);
  ws.addRow(["Total", { formula: "SUM(B2:B3)" }]);
  ws.addRow(["Saved", { formula: "B4*2", result: 2100 }]);
  wb.addWorksheet("Notes").addRow(["Hello"]);
  await wb.xlsx.writeFile(path);

  const sheets = await excelGrid(path);
  assert.deepEqual(sheets.map((s) => s.name), ["Budget", "Notes"]);
  const [budget] = sheets;
  assert.equal(budget.rows, 5);
  assert.deepEqual(budget.cells[0][0], { v: "Item", b: true });
  assert.deepEqual(budget.cells[1][1], { v: "800", n: true });
  assert.deepEqual(budget.cells[3][1], { v: "", f: "=SUM(B2:B3)" });
  assert.deepEqual(budget.cells[4][1], { v: "2100", f: "=B4*2", n: true });
  assert.equal(budget.cut, false);
});
