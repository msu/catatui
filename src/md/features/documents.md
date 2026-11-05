# Feature: PDF and Word Files

The `pdf_read`, `pdf_write`, `docx_read`, and `docx_write` tools read and write PDF and Word files. The code is in `src/catatui/documents.ts` and `src/catatui/pdfwrite.ts`. The writers share the Markdown parser in `src/catatui/markdown.ts`. For the accessibility behavior of the writers, see [accessibility.md](accessibility.md).

## Decisions

- The `read` tool cannot read binary files, and many students do not have Python. Assignments and readings are often PDF files. Business and humanities students write reports in Word.
- The libraries are Node libraries, so the student installs nothing more: `unpdf` (PDF text, from pdf.js), `mammoth` (Word to HTML), `docx` (write Word), `pdfkit` (write PDF), and `jszip` (read the Word XML for `a11y_check`).
- Each version is exact in `package.json` and is at least two weeks old at the time of the change. This gives time for the npm community to find a bad release.
- `pdf_read` returns the text page by page. `first` and `last` select pages. The limit is 50,000 characters.
- `docx_read` returns Markdown: headings, lists, tables, bold, and italic. mammoth gives HTML, and catatui changes it to Markdown.
- `docx_write` and `pdf_write` take simple Markdown, because models write Markdown well. They support `#` to `######` headings, paragraphs, `-` bullets, numbered items, tables, bold, italic, inline code, code blocks, links, and `![alt](image.png)` images.
- Numbered items use Word numbering, so screen readers find the list. Each list starts at 1.
- `pdf_write` uses pdfkit, with the DejaVu fonts embedded. The page is Letter with 1 inch margins.
- `docx_write` and `pdf_write` are file changes. `CHANGE_TOOLS` in `config.ts` has them, so the sandbox, the ask prompt, plan mode, `ta`, and `/undo` treat them like `write`. The read tools and `a11y_check` are in `READ_TOOLS`.

## Subtleties

- A scanned PDF has only images and no text. `pdf_read` then says that it found no text.
- PDF text has page headers and footers, and the order of columns can be wrong.
- `docx_write` and `pdf_write` replace the file. Images, comments, tracked changes, and other formatting in the old file are lost. The tool description tells the model this.
