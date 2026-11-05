---
name: accessible-documents
description: Make PDF, Word, and HTML documents that people with disabilities can use (screen readers, low vision, keyboard only). Use when the student writes a report, handout, syllabus, assignment, slide notes, or web page for other people, or asks about accessibility, WCAG, ADA, alt text, or PDF/UA.
---

# Accessible documents

## Tools

1. Write PDF files with `pdf_write` and Word files with `docx_write`. They add the tags, the title, the language, real lists, and table header rows.
2. Do not make a PDF by a print to PDF, a screenshot, or Python. These PDFs have no tags.
3. After you write a document, run `a11y_check` on it.
4. Fix each error and each warning. Then run `a11y_check` again.
5. Tell the student what the check cannot find (see "What a person must check").

## Rules for the content

1. Give each document a short title that says what it is.
2. Start with one `#` heading. Do not skip heading levels (`#` then `###`).
3. Use headings for sections, not bold text.
4. Write alt text for each image: say what the image shows and why it is there, in 1 or 2 sentences. Do not start with "Image of".
5. For a chart, give the main result in the alt text, and put the data in a table near it.
6. Give each table a header row. Do not use a table only for layout. Do not merge cells.
7. Write link text that names the target, for example "the CSCI 127 syllabus". Do not write "click here" or the address.
8. Do not show meaning with color only. Add text or a symbol, for example "Late (red)".
9. Use real lists (`-` or `1.`) for lists, not lines that start with typed characters.
10. Write clear, short sentences. Explain each abbreviation the first time.
11. If a part of the document is in a different language, tell the student that the writers set only one language for the document.

## Audit steps

Use these steps when the student asks for an accessibility audit of a document or a folder.

1. Run `a11y_check` one time on the path. With a folder, it checks all PDF, Word, and HTML files in it.
2. The app shows the results in a card with each file. Do not list each file and each problem again.
3. Write a short summary: the most frequent problems, and which documents need the most work.
4. Ask if the student wants you to fix the documents. Do not change a file before the student agrees.

## Fix steps

Use these steps when the student asks you to fix the accessibility problems in documents.

1. HTML: change the file with `edit`.
2. Word: read the file with `docx_read`, then write a new file with `docx_write`. Name it `<name>-accessible.docx`, next to the original.
3. PDF: read the file with `pdf_read`, then write a new file with `pdf_write`. Name it `<name>-accessible.pdf`, next to the original.
4. Do not replace or delete an original Word or PDF file. A new file loses some layout of the original, so the student must compare them.
5. If you do not know the alt text for an image, ask the student. Do not make it up.
6. Run `a11y_check` on each fixed file. Then tell the student what changed and what a person must check.

## Scanned or old PDF files

- If `a11y_check` says that a PDF has no text, the PDF is scanned images. Ask the student for the source document (Word or other). Make a new PDF from it with `pdf_write`.
- If there is no source, read the text with the student, write it as Markdown, and make a new PDF.
- `pdf_write` cannot fix an existing PDF. It makes a new one.

## What a person must check

- The alt text is correct and useful.
- The reading order is logical.
- Color is not the only way to show meaning.
- The language is clear for the readers.
- For a formal PDF/UA conformance claim, use a validator such as veraPDF or PAC (PDF Accessibility Checker).
