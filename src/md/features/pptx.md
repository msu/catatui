# Feature: PowerPoint Files

The `pptx_write` tool writes `.pptx` files. The code is in `src/catatui/pptx.ts`.

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
- `pptx_write` is a file change. `CHANGE_TOOLS` in `config.ts` has it, so the sandbox, the ask prompt, plan mode, the `ta` option, and `/undo` treat it like `write`.
- The tool has `promptGuidelines` that tell the model to use it and not Python.

## Subtleties

- `pptx_write` replaces the file. The old slides and their formatting are lost. The tool description tells the model this.
- An image must be a file in the project folder. Else the tool refuses it, so a deck does not copy other files of the student.
- The tool checks the first bytes of an image. Only PNG, JPEG, and GIF images go to pptxgenjs. Its dependency image-size 1.2.1 has `npm audit` findings (high): its JXL, HEIF, and ICNS parsers can loop forever. This check keeps those parsers from running.
- TODO: verify the MSU blue and gold with the MSU brand guide. The hex values in `THEMES` are placeholders.
- pptxgenjs depends on the npm package `https` 1.0.0. That package has only a `package.json` (no code and no install script), and Node loads its own `https` module first.
- macOS Quick Look shows the title, bullet, and table slides. It does not show the chart. The chart parts are in the file. Check charts in PowerPoint.
