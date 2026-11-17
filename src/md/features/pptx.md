# Feature: PowerPoint Files

The `pptx_read`, `pptx_write`, and `pptx_edit` tools read, write, and change `.pptx` files. The code is in `src/catatui/pptx.ts` and `src/catatui/pptx-edit.ts`.

## Decisions

- Many students do not have Python. Without this tool, the model uses Python and python-pptx, and this fails. A student reported "sudo pip install pandas openpyxl python-pptx: command not found".
- The tool uses pptxgenjs 4.0.1, a Node library. Node is already in the catatui install, so the student installs nothing more. pptxgenjs loads when the tool runs first, not at the catatui start.
- `pptx_write` writes a full deck: a list of slides. Each slide has a layout, a title, and optional speaker notes. The layouts:
  - `title`: the title and a subtitle.
  - `bullets`: the title and bullets. A bullet can have a level (a sub-bullet).
  - `two-columns`: `bullets` on the left, `right` on the right.
  - `image`: a `.png`, `.jpg`, or `.gif` file in the project, and bullets as a caption.
  - `table`: rows of text. The first row is the header.
  - `chart`: a bar, line, or pie chart with labels and series.
- The default theme is MSU: blue and gold, a sans font (Arial), a title slide, and the footer "Montana State University". `theme: "plain"` gives neutral colors with no footer. The model uses it if the student asks for a different look.
- The theme is one object at the top of `pptx.ts` (`THEMES`).
- The MSU logo is not in the deck, because it is a trademark.
- The deck is 16:9 (13.33 x 7.5 inches). Text boxes shrink the text if it is too long.
- `pptx_read` returns each slide in the order of `presentation.xml`: the number, the title, the text with bullet levels, the tables (tab-separated rows), the image names, the number of charts, and the speaker notes. A hidden slide has "(hidden)". The limit is 50,000 characters.
- `pptx_read` opens the zip with jszip (a direct dependency, 3.10.2) and reads the XML with small regular expressions. It needs no Python, no LibreOffice, and no XML library.
- The title is the `title` or `ctrTitle` placeholder. If a slide has no title placeholder (for example a `pptx_write` deck), the first text shape is the title.
- `pptx_read` skips the slide number, date, and footer placeholders, and the master and layout text. The MSU footer is in the master, so `pptx_read` does not show it.
- `pptx_read` is in `READ_TOOLS`.
- `pptx_edit` changes a deck that exists, and keeps its formatting. `pptx_write` replaces the whole deck. pptxgenjs cannot open a file, so `pptx_edit` changes the XML in the zip with jszip.
- `pptx_edit` takes a list of edits. Slide numbers are the numbers after the edits before them. All edits run in memory first. If one edit fails, the tool does not write the file. The edits:
  - `replace_text`: replace text on one slide (also in tables). If the old text is in one run, only that run changes, so its format stays. If it spans runs, the new text goes in the first run of the match. 0 matches is an error. More than 1 match is an error, unless `all` is true.
  - `set_notes`: replace the speaker notes. If the slide has no notes slide, the tool makes one from the notes master. If the deck has no notes master, the tool refuses.
  - `delete_slide`: remove the slide from the slide list, the sections, and the custom shows, and remove its part, its notes, and their Content_Types entries. If another slide links to it, the tool refuses. The tool does not delete the last slide.
  - `move_slide`: change the slide order. If the deck has sections, the slide moves to the section of its new neighbor.
  - `add_slide`: copy a template slide, then set the title and the bullets. The first paragraph of each bullet level is the format. The copy has no notes and no charts, because two slides cannot share one chart part safely. Other shapes of the template stay in the copy.
- `pptx_edit` cannot change layouts, masters, images, chart data, or SmartArt. These edits are not safe with direct XML changes.
- `pptx_write` and `pptx_edit` are file changes. `CHANGE_TOOLS` in `config.ts` has them, so the sandbox, the ask prompt, plan mode, the `ta` option, and `/undo` treat them like `write`.
- Each tool has `promptGuidelines` that tell the model to use it and not Python.

## Subtleties

- `pptx_write` replaces the file. The old slides and their formatting are lost. The tool description tells the model this.
- An image must be a file in the project folder. Else the tool refuses it, so a deck does not copy other files of the student.
- The tool checks the first bytes of an image. Only PNG, JPEG, and GIF images go to pptxgenjs. Its dependency image-size 1.2.1 has `npm audit` findings (high): its JXL, HEIF, and ICNS parsers can loop forever. This check keeps those parsers from running.
- TODO: verify the MSU blue and gold with the MSU brand guide. The hex values in `THEMES` are placeholders.
- pptxgenjs depends on the npm package `https` 1.0.0. That package has only a `package.json` (no code and no install script), and Node loads its own `https` module first.
- `pptx_read` does not read the text in SmartArt or in charts. It shows only the number of charts.
- macOS Quick Look shows the title, bullet, and table slides. It does not show the chart. The chart parts are in the file. Check charts in PowerPoint.
- pptxgenjs writes `[Content_Types].xml` Overrides for slide masters that do not exist (slideMaster2 and up). `pptx_edit` does not add or remove them.
- After `add_slide` or `move_slide`, a slide number field keeps its old text until PowerPoint updates the fields. macOS Quick Look shows the old number.
