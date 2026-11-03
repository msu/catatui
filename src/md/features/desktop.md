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
4. Done: the project screen (recent projects and a folder picker), the Chats menu (new chat and old chats), and the history of an old chat.
5. Done: the Files panel. It lists the files that the agent changed in this chat, with a diff for each text file.
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
- Without a folder on the command line, the app shows the project screen. The recent projects are the folders of the catatui sessions (`SessionManager.listAll` from pi), newest first. A folder that does not exist now is not shown. A folder with no chat yet is not in the list.
- The main process loads pi only for the session lists, because pi is large.
- A click on the project path in the header goes back to the project screen. A new project stops catatui and starts it in the new folder.
- The Chats menu lists the chats of the project (`SessionManager.list`). An old chat opens with `switch_session`, then `get_messages` gives its messages. `itemsFromMessages` in `chat.js` makes the chat items. The tool results are in separate `toolResult` messages.
- The main process keeps a copy of each file before the first change in the chat: at `tool_execution_start` of a tool in `CHANGE_TOOLS` (config.ts). The Files panel compares this copy with the file now. So after `/undo`, or a change by the student, the panel is correct.
- The renderer makes the diff with the `diff` package (`structuredPatch`).
- A file with a zero byte in its first 8 KB is binary (Excel and Word files are zip files). The panel shows "Open the file" for it, with no diff. Files over 300 KB also have no diff.
- "Open the file" opens only files in the project, with the normal app for the file type.
- Limits: the panel does not show changes from bash commands. For an old chat that the student opens again, the list starts empty.
- Sign-out stops catatui and calls `clearSignIn` (the same as `/catchat logout`).
- `CATATUI_DESKTOP_CLICK="a ;; b"` clicks each element before the screenshot. `CATATUI_DESKTOP_WAIT` sets the wait before the prompt (milliseconds).
- `CATATUI_DESKTOP_SNAPSHOT=out.png` runs the app with a hidden window and saves a screenshot. `CATATUI_DESKTOP_PROMPT` sends a prompt first, and `CATATUI_DESKTOP_ANSWER=1` clicks the first option of each dialog. This is for tests.
