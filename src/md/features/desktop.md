# Feature: Desktop App

A desktop app (like Claude Desktop) for students who do not use the command line. The code is in `desktop/`.

## Decisions

- Electron, because it has Node. The app runs catatui with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), so the student does not install Node.
- The app starts `bin/catatui.js --mode rpc` as a child process in the project folder. It talks to catatui with pi RPC: JSONL commands on stdin, and responses and events on stdout. See pi `docs/rpc.md`, `docs/json.md`, and `docs/rpc-extension-ui.md`.
- The catatui extension works with no change: the provider, the models, the tools, the sandbox, the permissions, and undo.
- The code is in this repository, so the app and the CLI use the same extension code. The CLI npm package does not include `desktop/` (see `files` in `package.json`).
- The renderer is React, built with Vite to `desktop/dist/`. It has no Node access. `preload.cjs` gives it four functions: `command`, `respond`, `project`, and events.
- Dialogs from catatui (`ctx.ui.select`, `confirm`, `input`, `editor`) show as a modal. Notices show in the chat. `setStatus` entries (for example the mode) show as chips in the header.
- Model output can contain HTML. The app shows HTML as text, and the page has a strict Content-Security-Policy.
- Links open in the normal browser, not in the app.
- Each dependency version is exact and at least two weeks old at the time of the change.

## Milestones

1. Done: the window, the RPC child, the chat with streaming, tool cards, dialogs, and Stop.
2. Done: the sign-in screen (MSU SSO or a pasted key), the model menu, the expiry banner, and sign-out.
3. Done: the mode menu (mode, ta, sandbox, ste) and the Undo button. Allow and Deny dialogs were done in milestone 1.
4. Projects: a folder picker, recent projects, and session history.
5. Files: changed files with diffs. The `edit` tool gives `details.diff`. For other tools, the app reads the file at `tool_execution_start` and `tool_execution_end`.
6. Ship: electron-builder, macOS notarization, Windows signing, GitHub Releases, auto-update, and download links on the site.

## Subtleties

- Read stdout as JSONL and split only on LF. Node `readline` also splits on U+2028 and U+2029, which can be in JSON strings.
- In RPC mode, `ctx.mode` is `"rpc"`. catatui code that checks for `"tui"` (the header, the footer, the default model pick) does not run.
- RPC mode has no `/login`. The main process does the sign-in with the CLI code: `ssoLogin` and `pastedKey` from `auth.ts`, and `saveCredential` from `store.ts`. It loads these TypeScript files with jiti. `store.ts` does not import pi, so this is fast.
- pi keeps the sign-in in memory. After a new sign-in, the app starts catatui again.
- In RPC mode, pi does not load the CatChat models at start. catatui (`session_start` in `index.ts`) loads them and selects a model from `PREFERRED_MODELS` if there is a sign-in.
- If the key expired, the app shows the sign-in screen. If it expires in 14 days or less, a banner offers a new key.
- The `/mode` panel uses `ctx.ui.custom()`, which does nothing in RPC mode. The app has its own mode menu. It reads the JSON status `catatui` and sends `/mode <word> on|off` (see modes.md).
- The Undo button sends `/undo`. The undo confirm is a normal dialog.
- Tool cards show paths in the project without the project folder.
- Sign-out stops catatui and calls `clearSignIn` (the same as `/catchat logout`).
- `CATATUI_DESKTOP_CLICK="a ;; b"` clicks each element before the screenshot. `CATATUI_DESKTOP_WAIT` sets the wait before the prompt (milliseconds).
- `CATATUI_DESKTOP_SNAPSHOT=out.png` runs the app with a hidden window and saves a screenshot. `CATATUI_DESKTOP_PROMPT` sends a prompt first, and `CATATUI_DESKTOP_ANSWER=1` clicks the first option of each dialog. This is for tests.
