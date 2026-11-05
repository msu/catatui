# catatui

catatui is a terminal coding agent for MSU students. I (`@earendil-works/pi-coding-agent`). It uses the MSU CatChat models. CatVibes is the MSU GUI client.

## Stack

- TypeScript extension in `src/catatui/`. pi loads it with jiti, so the project has no build step.
- `bin/catatui.js` starts pi with the extension, themes, and skills.
- Tests in `test/` use the Node test runner (`node:test`). They use no model and no network. To test the UI, run catatui in a terminal.

## Run

- To install the packages, run `npm install`.
- To run catatui, run `node bin/catatui.js`.
- To run the tests, run `npm test`.

## Files

- `bin/catatui.js`: the `catatui` command
- `bin/update.js`: `catatui --version` update check and `catatui --update`
- `src/catatui/`: the pi extension. `index.ts` is the entry point.
- `src/md/`: the intent of this project
- `skills/`: the `simplified-technical-english` skill
- `themes/`: the `msu` and `msu-light` themes
- `assets/`: the bobcat logo
- `docs/`: the GitHub Pages site, and the install scripts `install.sh` and `install.ps1`
- `install.sh`, `install.ps1`: forwarders to the site for old installs
- `test/`: the tests. `fake-pi.ts` is a small stand-in for the pi extension API.
- `tmp/`: scratch work, plans, and TODOs. Git ignores this folder.

## Rules

- Change `src/md` first, then change the code.
- Use STE (ASD-STE100 Simplified Technical English) for all files in `src/md`, and for comments and error messages.
- Increase the version in `package.json` for each release. `catatui --version` compares this value with GitHub.

## Subtleties

- catatui changes three pi internals. See [infrastructure/pi-harness.md](infrastructure/pi-harness.md) before you update pi.
- The order of the `tool_call` handlers is important: sandbox, then permissions, then undo. The first block stops the chain, so undo sees only allowed calls.
- The extension changes pi behavior only when `CATATUI=1`. As a plain pi package, it does not change the theme, the model, or the permissions.

## File Index

- [features/sign-in.md](features/sign-in.md): SSO and pasted key sign-in, and the first start
- [features/models.md](features/models.md): default model, hidden models, and model notes
- [features/modes.md](features/modes.md): ask, plan, auto, and yolo modes, and the `/mode` panel
- [features/auto-mode.md](features/auto-mode.md): auto mode and the safety check (judge.ts), and the evaluation
- [features/sandbox.md](features/sandbox.md): limit on files outside the project folder
- [features/teaching-assistant.md](features/teaching-assistant.md): the `ta` option
- [features/ste.md](features/ste.md): Simplified Technical English option
- [features/undo.md](features/undo.md): the `/undo` command
- [features/context.md](features/context.md): the `/context` grid
- [features/idle-compact.md](features/idle-compact.md): compaction while the student is away
- [features/suggest.md](features/suggest.md): suggestions in the message box (Tab accepts)
- [features/excel.md](features/excel.md): the `excel_read` and `excel_write` tools
- [features/documents.md](features/documents.md): the `pdf_read`, `pdf_write`, `docx_read`, and `docx_write` tools
- [features/accessibility.md](features/accessibility.md): accessible documents, the `a11y_check` tool, and the accessible-documents skill
- [features/web.md](features/web.md): the `show_page` and `server` tools
- [features/help.md](features/help.md): the `/help` command and the header tip
- [features/desktop.md](features/desktop.md): the Electron desktop app
- [features/msu.md](features/msu.md): MSU context in the system prompt, and the class schedule question
- [features/new-project.md](features/new-project.md): the `new_project` tool
- [features/widgets.md](features/widgets.md): the `show_widget` tool and the inline widgets
- [features/advising.md](features/advising.md): the academic advising demo (mock transcript, requirements, and classes)
- [features/classes.md](features/classes.md): the classes demo (mock assignments, grades, syllabus, and course materials)
- [features/git.md](features/git.md): the git tools (dugite), the GitHub token, and the git safety settings
- [features/run.md](features/run.md): the `run` tool and the file tools (`move`, `copy`, `delete`, `mkdir`)
- [features/windows.md](features/windows.md): Windows with no Git for Windows (PowerShell in place of bash)
- [features/http-tool.md](features/http-tool.md): the `http` tool
- [features/screen.md](features/screen.md): header, footer, themes, and name
- [features/website.md](features/website.md): the GitHub Pages site
- [infrastructure/pi-harness.md](infrastructure/pi-harness.md): why pi, the launcher, and changes to pi internals
- [infrastructure/distribution.md](infrastructure/distribution.md): install scripts and updates
- [infrastructure/catai-install.md](infrastructure/catai-install.md): the hidden Windows installer for internal tests of catai

## Plans

- [plans/auto-mode.md](plans/auto-mode.md): the auto mode plan and the evaluation results (built, see features/auto-mode.md)
