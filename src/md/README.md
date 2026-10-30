# catatui

catatui is a terminal coding agent for MSU computer science students. It is an extension to the pi coding agent (`@earendil-works/pi-coding-agent`). It uses the MSU CatChat models. CatVibes is the MSU GUI client.

## Stack

- TypeScript extension in `src/ts/`. pi loads it with jiti, so the project has no build step.
- `bin/catatui.js` starts pi with the extension, themes, and skills.
- The project has no automated tests. To test the UI, run catatui in a terminal.

## Files

- `bin/catatui.js`: the `catatui` command
- `bin/update.js`: `catatui --version` update check and `catatui --update`
- `src/ts/`: the pi extension. `index.ts` is the entry point.
- `src/md/`: the intent of this project
- `skills/`: the `simplified-technical-english` skill
- `themes/`: the `msu` and `msu-light` themes
- `assets/`: the bobcat logo
- `install.sh`, `install.ps1`: install scripts for macOS and Linux, and for Windows
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

- [features/sign-in.md](features/sign-in.md): pasted key sign-in and the first start
- [features/models.md](features/models.md): default model, hidden models, and model notes
- [features/modes.md](features/modes.md): ask, plan, and yolo modes, and the `/mode` panel
- [features/sandbox.md](features/sandbox.md): limit on files outside the project folder
- [features/teaching-assistant.md](features/teaching-assistant.md): the `ta` option
- [features/ste.md](features/ste.md): Simplified Technical English option
- [features/undo.md](features/undo.md): the `/undo` command
- [features/http-tool.md](features/http-tool.md): the `http` tool
- [features/screen.md](features/screen.md): header, footer, themes, and name
- [infrastructure/pi-harness.md](infrastructure/pi-harness.md): why pi, the launcher, and changes to pi internals
- [infrastructure/distribution.md](infrastructure/distribution.md): install scripts and updates
