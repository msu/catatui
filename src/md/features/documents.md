# Feature: PDF and Word Files

The `pdf_read`, `docx_read`, and `docx_write` tools read PDF files and read and write Word files. The code is in `src/catatui/documents.ts`.

## Decisions

- The `read` tool cannot read binary files, and many students do not have Python. Assignments and readings are often PDF files. Business and humanities students write reports in Word.
- The libraries are Node libraries, so the student installs nothing more: `unpdf` (PDF text, from pdf.js), `mammoth` (Word to HTML), and `docx` (write Word).
- Each version is exact in `package.json` and is at least two weeks old at the time of the change. This gives time for the npm community to find a bad release.
- `pdf_read` returns the text page by page. `first` and `last` select pages. The limit is 50,000 characters.
- `docx_read` returns Markdown: headings, lists, tables, bold, and italic. mammoth gives HTML, and catatui changes it to Markdown.
- `docx_write` takes simple Markdown, because models write Markdown well. It supports `#` to `###` headings, paragraphs, `-` bullets, numbered items, tables, bold, and italic.
- Numbered items keep the number as text. Word numbering needs a numbering setup, and the text is simpler.
- `docx_write` is a file change. `CHANGE_TOOLS` in `config.ts` has it, so the sandbox, the ask prompt, plan mode, `ta`, and `/undo` treat it like `write`. The read tools are in `READ_TOOLS`.

## Subtleties

- A scanned PDF has only images and no text. `pdf_read` then says that it found no text.
- PDF text has page headers and footers, and the order of columns can be wrong.
- `docx_write` replaces the file. Images, comments, tracked changes, and other formatting in the old file are lost. The tool description tells the model this.
