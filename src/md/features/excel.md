# Feature: Excel Files

The `excel_read` and `excel_write` tools read and write `.xlsx` files. The code is in `src/catatui/excel.ts`.

## Decisions

- Many students (for example business students) do not have Python. Without these tools, the model uses Python and openpyxl to write Excel files, and this fails.
- The tools use exceljs, a Node library. Node is already in the catatui install, so the student installs nothing more.
- `excel_read` returns each sheet as tab-separated rows, with the row number first. The model can then name cells (A1, B2). A formula shows as `=FORMULA -> last result`. The limit is 500 rows per sheet and 50,000 characters.
- `excel_write` writes a full workbook: sheets of rows of values. A string that starts with `=` is a formula. The first row is bold and frozen by default. The column width comes from the longest value.
- Models often send numbers as strings (`"1.50"`). Excel keeps a string as text, and SUM skips text. So `excel_write` makes a number from a string that is a number. A string with a leading zero (a zip code, `007`) stays text.
- `excel_write` sets "full calculation on load", because exceljs does not calculate formulas. Excel calculates them when the student opens the file.
- `excel_write` is a file change. `CHANGE_TOOLS` in `config.ts` has it, so the sandbox, the ask prompt, plan mode, the `ta` option, and `/undo` treat it like `write`. `excel_read` is in `READ_TOOLS`.
- `/undo` keeps file copies as bytes, so it can put back `.xlsx` files.
- Each tool has `promptGuidelines` that tell the model to use it and not Python.

## Subtleties

- `excel_write` replaces the file. Formatting, charts, and pivot tables in the old file are lost. The tool description tells the model this.
- After `excel_write`, `excel_read` shows formulas with no result, because no program calculated them yet.
- exceljs 4.4.0 brings 9 moderate `npm audit` findings (uuid, minimatch, from archiver). catatui does not give student input to the affected functions.
