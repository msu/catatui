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

## 0.8.1 - 2026-11-16

### Removed

- The thumbs-down button in catai.

## 0.8.0 - 2026-11-16

This release also has the catai changes from 2026-11-05 to 2026-11-15. The catai installer got them at each pin, but the version stayed 0.7.1.

### Added

- Feedback:
  - A Cloudflare Worker in `feedback/` that stores the reports.
  - `/feedback` in catatui. It can attach the last model error.
  - Help > Send Feedback... in catai, with an optional screenshot.
  - A "Report this error" button on each error in catai.
- `git_commit` shows the diff in the approval.
- `/update` offers to run the npm install.
- catai:
  - Accessibility audit: folder `a11y_check`, audit card, fix steps.
  - `--demo-mode` on macOS.
  - Excel preview, project picker, New menu, Open in Terminal, drag and drop moves, read-only previews.
  - Text editor (CodeMirror) with `editor_edit`, AGENTS.md, file drops, delete, Open names, and a resizable tree.
  - Get a project from GitHub, with a progress bar.
  - Changes in the side panel: per-block revert, changed tabs, card buttons, git init and commit.
  - New logo: a cat speech bubble replaces the bobcat.
- Installers: a macOS script for catai, a pinned commit, a private npm cache, and a catai PATH hint.

### Changed

- catai: the diff view is read only, except Revert and Keep.
- catai: a folder drop on the chat tells the agent.

### Fixed

- git: ignore EPIPE on stdin.
- catai finds jiti in all npm layouts.
- The Windows installer stops a running catai.

## 0.7.1 - 2026-11-04

### Added

- Prompt injection controls: taint, quiet GET, and no comments for the judge.

## 0.7.0 - 2026-11-04

### Added

- Auto mode, suggestions, settings, and accessible documents.

## 0.6.4 - 2026-11-04

### Added

- Compact while idle.
- git tools (dugite), run tools, and file tools.
- PowerShell on Windows.
- GitHub token sign-in.
- The hidden catai installer.

## 0.6.3 - 2026-11-03

### Added

- Automated tests.

### Fixed

- The sandbox works with linked folders.
- The preview shows only project web apps.

## 0.6.2 - 2026-11-03

### Changed

- catai sets `CATAI=1` for the app-only tools.

## 0.6.1 - 2026-11-03

### Changed

- App-only tools load only in the desktop app.

## 0.6.0 - 2026-11-03

### Added

- The catai desktop app: chat, sign-in, models, mode menu, undo, projects, chat history, files panel, file tree, file cards, and dialogs.
- catai: session menu, windows, conversations, fast switch, and plan card.
- catai: advising and classes demos.
- catai: side panel with pinned files, web preview, and the `show_preview` tool.
- catai: the `open_view` tool, thinking level, queued messages, and message suggestions.
- catai: remove sensitive text from conversations, and permanent delete.
- MSU context and the `new_project` tool.

## 0.5.13 - 2026-11-03

### Added

- Excel, PDF, Word, `show_page`, and server tools.
- `/help` and a header tip.

## 0.5.12 - 2026-11-03

### Changed

- Site: students and staff.

## 0.5.11 - 2026-11-03

### Added

- A styled sign-in callback page.
- A command line tutorial notice.

## 0.5.10 - 2026-11-03

### Added

- `/catchat login` and `/catchat logout`.
- A key expiry warning.
- The Student team.

## 0.5.9 - 2026-11-03

### Changed

- MSU SSO sign-in (CatChat App Connect) is the default.

## 0.5.8 - 2026-11-03

### Fixed

- The key steps stay visible after CatChat Access opens (#1).

## 0.5.7 - 2026-11-03

### Added

- The `/context` grid.
- An old-install notice on the site.

## 0.5.6 - 2026-11-03

### Changed

- Update pi to 1.5.0.
- Hide the pi update notices.
- Add the shortcuts to the site.

## 0.5.5 - 2026-11-03

### Added

- Model descriptions.

## 0.5.4 - 2026-11-03

### Changed

- Hide thinking by default.
- Document `--list-models`.

## 0.5.3 - 2026-11-03

### Added

- The `--sso` flag for SSO sign-in tests.
- The Pages site.

### Changed

- The install scripts move to catatui.cs.montana.edu.

### Fixed

- The installer version message.

## 0.5.2 - 2026-10-29

### Changed

- README: fix typos, add the STE link and the mode details.

## 0.5.1 - 2026-10-29

### Changed

- Use lowercase catatui.
