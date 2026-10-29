# AGENTS.md

catatui is a terminal coding agent for MSU computer science students. It is an extension to the pi coding agent (`@earendil-works/pi-coding-agent`). It uses the MSU CatChat models.

## Layout

| Path | Content |
|---|---|
| `bin/catatui.js` | The `catatui` command. Starts pi with the extension, themes, skills, and `~/.catatui`. |
| `bin/update.js` | `catatui --version` update check and `catatui --update` |
| `src/ts/` | The pi extension. `index.ts` is the entry point. |
| `src/md/` | Project documentation. Read `src/md/design.md` before you change the design. |
| `skills/` | The `simplified-technical-english` skill |
| `themes/` | The `msu` and `msu-light` themes |
| `assets/` | The bobcat logo |
| `install.sh`, `install.ps1` | Install scripts for macOS and Linux, and for Windows |
| `tmp/` | Scratch work, for example notes, test output, and feedback. Git ignores this folder. |

## Rules

- Write prose in Simplified Technical English: docs, comments, and error messages.
- Increase the version in `package.json` for each release. `catatui --version` compares this value with GitHub.
- If you change a design decision, update `src/md/design.md`.

## Run

| Task | Command |
|---|---|
| Install packages | `npm install` |
| Run | `node bin/catatui.js` |
