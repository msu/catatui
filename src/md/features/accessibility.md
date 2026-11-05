# Feature: accessible documents

catatui helps students make documents that people with disabilities can use. There are 3 parts:

1. The writers (`pdf_write`, `docx_write`) make accessible files by default.
2. The `a11y_check` tool finds common problems in PDF, Word, and HTML files.
3. The `accessible-documents` skill gives the rules and the workflow (write, check, fix, check again).

The code is in `src/catatui/pdfwrite.ts`, `src/catatui/documents.ts`, `src/catatui/markdown.ts`, and `src/catatui/a11y.ts`. The skill is in `skills/accessible-documents/SKILL.md`.

## Writers

- Both writers take the same simple Markdown (`markdown.ts`), a `title` (necessary), and a `lang` (default `en-US`).
- The writers refuse an image with no alt text, an image outside the project, an image that is not PNG or JPEG, and a table with no data row.
- The writers give warnings, but write the file, for: no headings, a skipped heading level, a first heading that is not level 1, and link text such as "click here".
- `pdf_write` (pdfkit 0.20.2):
  - Tagged PDF and PDF/UA-1 (`subset: "PDF/UA"`, the `pdfuaid` XMP entry), PDF 1.7.
  - The title, with `DisplayDocTitle`, and the document language.
  - A structure tree: `Document`, `H1` to `H6`, `P`, `L`/`LI`/`Lbl`/`LBody`, `Table`/`TR`/`TH` (scope Column)/`TD`, and `Figure` with alt text and a bounding box.
  - The table borders are artifacts. Bookmarks for level 1 and level 2 headings.
  - The DejaVu fonts (`dejavu-fonts-ttf`) are embedded. PDF/UA does not allow fonts that are not embedded, and the pdfkit standard fonts are not embedded.
  - Links show as "text (address)". pdfkit does not put link annotations in the structure tree, and PDF/UA requires this. So the PDF has no link annotations.
- `docx_write` (docx 9.13.0):
  - The title (core properties) and the default language (`w:lang` in the document defaults).
  - Word headings, Word bullets and numbering (not typed characters), a table header row (`tblHeader`), image alt text (`descr`), and links.

## a11y_check

- PDF (pdf.js through unpdf): text (or scanned), tags (`MarkInfo`), a structure tree on each page, the title and `DisplayDocTitle`, the language, the heading order, figure alt text, table header cells, embedded fonts, and the PDF/UA identifier. It reads at most 200 pages.
- Word (jszip and the XML): the title, the language, the heading order (by style name, so it works in all Word languages), bold paragraphs that look like headings, typed list items, 3 or more empty paragraphs, image alt text or "decorative", table header rows, link text, and text colors with a contrast below 4.5:1 on white.
- HTML (regular expressions, basic): `lang`, `<title>`, `img` alt, the heading order, `<th>`, link text, and form field labels.
- The result has errors, warnings, what passed, and the limits.

## Decisions

- A tool for the checks, not only the model. A model cannot read the tags of a PDF reliably, and the same file must give the same result each time.
- A skill, not a mode. Modes control permissions. Accessibility applies to one kind of task. pi loads the skill when the task matches its description. A later option (like `ste`) can load it all the time.
- The writers refuse the errors that a person cannot fix later in the file (no alt text). Other problems are warnings, so the model can fix them and write again.
- pdfkit because it makes tagged PDF in Node, with no installed program, also in the terminal catatui. A browser print to PDF (for example Electron `printToPDF`) needs the desktop app, and its tag output is not tested.
- jszip is a direct dependency, at the same version that docx, mammoth, and exceljs use.

## Subtleties

- `a11y_check` does not prove PDF/UA or WCAG conformance. For example, it does not check the reading order, the contrast in a PDF, or the quality of alt text. The result says this, and names veraPDF and PAC.
- The PDF output is not yet checked with veraPDF or PAC. Do this before any conformance claim.
- The writers set one language for the document. Text in a second language has no language tag.
- In `pdf_write`, a list item has no bold or italic. `doc.list` takes plain text.
- In `pdf_write`, the header row of a long table does not repeat on each page.
- pdf.js detaches the buffer that it reads. Give it a copy.
