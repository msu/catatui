# Changelog

## 0.9.0 - 2026-11-16

### Added

- PowerPoint tools. They need no Python and no other install.
  - `pptx_write`: write a deck. Layouts: title, bullets, two columns, image, table, and chart. The default theme is MSU. `theme: "plain"` gives neutral colors.
  - `pptx_read`: read the slides, tables, image names, and speaker notes of a deck.
  - `pptx_edit`: change a deck and keep its format. Edits: replace text, set notes, delete a slide, move a slide, and add a slide from a template slide.
- `pptx_write` and `pptx_edit` are file changes. The sandbox, the ask prompt, plan mode, and `/undo` apply to them.

### Known issues

- The MSU blue and gold are placeholders.
- `pptx_edit` cannot change layouts, masters, images, chart data, or SmartArt.
- `pptx_read` does not read the text in SmartArt or in charts.
- macOS Quick Look does not show charts.
