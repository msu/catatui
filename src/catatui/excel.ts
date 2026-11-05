// "excel_read" and "excel_write" tools: the model can read and write .xlsx files with no Python.
// Business students often do not have Python, and the read and write tools cannot use binary files.
// excel_write is a file change, so sandbox.ts, permissions.ts, and undo.ts treat it like "write".
// See src/md/features/excel.md.
// exceljs loads when a tool runs first, not at catatui start. This keeps the start fast.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";

const MAX_ROWS = 500;
const MAX_CHARS = 50_000;

const CELL = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]);

const READ_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .xlsx file" }),
  sheet: Type.Optional(Type.String({ description: "Sheet name. Default: all sheets" })),
});

const WRITE_PARAMS = Type.Object({
  path: Type.String({ description: "Path to the .xlsx file. The tool replaces the file if it exists." }),
  sheets: Type.Array(
    Type.Object({
      name: Type.String({ description: "Sheet name (at most 31 characters)" }),
      rows: Type.Array(Type.Array(CELL), { description: "Rows of cells. Use JSON numbers for numbers (1.5, not \"1.5\"). A string that starts with = is a formula, for example =SUM(B2:B10)." }),
      header: Type.Optional(Type.Boolean({ description: "If true, the first row is bold and frozen. Default: true" })),
    }),
    { description: "The sheets of the workbook, in order" },
  ),
});

const fullPath = (cwd: string, path: string) => resolve(cwd, path.replace(/^@/, ""));

// Models often send numbers as strings ("1.50"). Excel keeps a string as text, and SUM skips text. So make a number from it.
// Keep a leading zero (a zip code or an id like "007") as text.
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function cell(v: string | number | boolean | null): ExcelJS.CellValue {
  if (typeof v !== "string") return v;
  if (v.startsWith("=")) return { formula: v.slice(1) };
  return NUMBER.test(v.trim()) ? Number(v) : v;
}

// The value to show for a cell. For a formula, show the formula and the last result that Excel saved.
function show(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== "object") return String(v);
  if ("formula" in v || "sharedFormula" in v) {
    const f = "formula" in v ? v.formula : v.sharedFormula;
    return v.result === undefined ? `=${f}` : `=${f} -> ${show(v.result as ExcelJS.CellValue)}`;
  }
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("text" in v) return String(v.text);
  if ("error" in v) return String(v.error);
  return JSON.stringify(v);
}

// Tab-separated text, with the row number first, so the model can name cells (A1, B2).
function sheetText(ws: ExcelJS.Worksheet): string {
  const lines = [`## Sheet "${ws.name}" (${ws.rowCount} rows, ${ws.columnCount} columns)`];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n > MAX_ROWS) return;
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(show(row.getCell(c).value));
    lines.push(`${n}\t${cells.join("\t")}`);
  });
  if (ws.rowCount > MAX_ROWS) lines.push(`[Rows after ${MAX_ROWS} not shown.]`);
  return lines.join("\n");
}

// The desktop app shows a workbook as a grid in the side panel (FilePane). One cell: the text to show,
// the formula (if any), and if it is a number (right aligned) or bold.
export interface GridCell { v: string; f?: string; n?: boolean; b?: boolean }
export interface GridSheet { name: string; rows: number; cols: number; cells: (GridCell | null)[][]; cut: boolean }
const GRID_ROWS = 500;
const GRID_COLS = 52;

function gridCell(c: ExcelJS.Cell): GridCell | null {
  const v = c.value;
  if (v === null || v === undefined) return null;
  const out: GridCell = { v: "" };
  let shown: ExcelJS.CellValue = v;
  if (typeof v === "object" && !(v instanceof Date) && ("formula" in v || "sharedFormula" in v)) {
    out.f = `=${"formula" in v ? v.formula : v.sharedFormula}`;
    shown = (v.result as ExcelJS.CellValue) ?? null;
  }
  // A formula with no saved result (for example from excel_write) shows as an empty value. The app shows the formula.
  out.v = shown === null || shown === undefined ? "" : show(shown);
  if (typeof shown === "number") out.n = true;
  if (c.font?.bold) out.b = true;
  return out;
}

// All sheets of a workbook, at most GRID_ROWS rows and GRID_COLS columns each.
export async function excelGrid(path: string): Promise<GridSheet[]> {
  const wb = new (await import("exceljs")).default.Workbook();
  await wb.xlsx.readFile(path);
  return wb.worksheets.map((ws) => {
    const rows = Math.min(ws.rowCount, GRID_ROWS);
    const cols = Math.min(ws.columnCount, GRID_COLS);
    const cells: (GridCell | null)[][] = [];
    for (let r = 1; r <= rows; r++) {
      const row = ws.getRow(r);
      const line: (GridCell | null)[] = [];
      for (let c = 1; c <= cols; c++) line.push(gridCell(row.getCell(c)));
      cells.push(line);
    }
    return { name: ws.name, rows: ws.rowCount, cols: ws.columnCount, cells, cut: ws.rowCount > GRID_ROWS || ws.columnCount > GRID_COLS };
  });
}

export function registerExcelTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "excel_read",
    label: "Excel read",
    description: `Read an Excel .xlsx file. Returns each sheet as tab-separated rows. The first value on each line is the row number. Columns are A, B, C... Formulas show as =FORMULA -> last result. At most ${MAX_ROWS} rows per sheet.`,
    promptSnippet: "Read Excel .xlsx files (use this, not Python)",
    promptGuidelines: ["For .xlsx files, use excel_read and excel_write. Do not use read, bash, or Python for them. The student can have no Python."],
    parameters: READ_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const wb = new (await import("exceljs")).default.Workbook();
      await wb.xlsx.readFile(fullPath(ctx.cwd, params.path));
      const sheets = params.sheet ? [wb.getWorksheet(params.sheet)].filter(Boolean) : wb.worksheets;
      if (sheets.length === 0) {
        throw new Error(`The workbook has no sheet "${params.sheet}". Sheets: ${wb.worksheets.map((w) => w.name).join(", ")}`);
      }
      let text = sheets.map((ws) => sheetText(ws as ExcelJS.Worksheet)).join("\n\n");
      if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n[Output cut at ${MAX_CHARS} characters. Read one sheet with the sheet parameter.]`;
      return { content: [{ type: "text", text }], details: { sheets: sheets.length } };
    },
  });

  pi.registerTool({
    name: "excel_write",
    label: "Excel write",
    description:
      "Write an Excel .xlsx file. Replaces the file if it exists. To change a workbook, read it with excel_read, then write all sheets again. " +
      "A string that starts with = is a formula. Excel calculates formulas when the student opens the file. Formatting other than a bold header is not kept.",
    promptSnippet: "Write Excel .xlsx files with values and formulas (use this, not Python)",
    parameters: WRITE_PARAMS,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const wb = new (await import("exceljs")).default.Workbook();
      // The file has no saved formula results, so Excel must calculate all formulas when it opens the file.
      wb.calcProperties.fullCalcOnLoad = true;
      for (const s of params.sheets) {
        const ws = wb.addWorksheet(s.name.slice(0, 31));
        for (const row of s.rows) {
          ws.addRow(row.map(cell));
        }
        if (s.header !== false && s.rows.length > 0) {
          ws.getRow(1).font = { bold: true };
          ws.views = [{ state: "frozen", ySplit: 1 }];
        }
        // Column width from the longest value, so the student can read the sheet.
        ws.columns.forEach((col) => {
          let w = 8;
          col.eachCell?.({ includeEmpty: false }, (cell) => { w = Math.max(w, Math.min(50, show(cell.value).length + 2)); });
          col.width = w;
        });
      }
      const path = fullPath(ctx.cwd, params.path);
      mkdirSync(dirname(path), { recursive: true });
      await wb.xlsx.writeFile(path);
      const summary = params.sheets.map((s) => `${s.name} (${s.rows.length} rows)`).join(", ");
      return { content: [{ type: "text", text: `Wrote ${params.path}: ${summary}` }], details: { sheets: params.sheets.length } };
    },
  });
}
