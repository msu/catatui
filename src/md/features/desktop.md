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
- The project screen has "Open a folder..." at the top and "Or open a recent project" under it. If a project is open, Cancel and Escape go back to it.
- Without a folder on the command line, the app shows the project screen. The recent projects are the folders of the catatui sessions (`SessionManager.listAll` from pi), newest first. A folder that does not exist now is not shown. A folder with no chat yet is not in the list.
- The main process loads pi only for the session lists, because pi is large.
- A click on the project path in the header goes back to the project screen. A new project stops catatui and starts it in the new folder.
- The Chats menu lists the chats of the project (`SessionManager.list`). An old chat opens with `switch_session`, then `get_messages` gives its messages. `itemsFromMessages` in `chat.js` makes the chat items. The tool results are in separate `toolResult` messages.
- The main process keeps a copy of each file before the first change in the chat: at `tool_execution_start` of a tool in `CHANGE_TOOLS` (config.ts). The Files panel compares this copy with the file now. So after `/undo`, or a change by the student, the panel is correct.
- The renderer makes the diff with the `diff` package (`structuredPatch`).
- A file with a zero byte in its first 8 KB is binary (Excel and Word files are zip files). The panel shows "Open the file" for it, with no diff. Files over 300 KB also have no diff.
- "Open the file" opens only files in the project, with the normal app for the file type.
- Limits: the panel does not show changes from bash commands. For an old chat that the student opens again, the list starts empty.
- Chat and Project. The app starts in Chat. A chat is a project in a hidden folder, `Documents/catai/Chats/<date time>`, with the same tools (also code), but with no file tree and no path row. The header has a Chat and Project switch. The Chats button shows the name of the open chat (or the last chat). The Projects button shows the name of the open project (or the last project). Both buttons have a fixed width, and a long name ends in "...". In a project, the path row shows "Project Directory:" and the path (a click opens the project screen). Chats and Projects are split buttons. A click on the main part moves to the last chat or the last project (the folder picker if there is no project). The arrow opens a menu: Chats has "New chat" and the five last chats. Projects has "New project...", "New chat in this project" (in a project only), the five last projects, and "All projects...". History on the right shows all chats and projects.
- At launch the app reuses the newest chat folder if it is empty and has no chat, so launches do not leave empty folders.
- If the app was last in a project, the empty chat shows "Resume project <name>". `state.json` has `lastProject` and `lastKind`.
- The Project tab is a menu: "New project...", the five last projects, and "All projects...". "New project..." opens "Select A Folder For Your Project", a folder picker in the app. It has places on the left (catai projects, Documents, Desktop, Downloads, Home), the folders on the right, and "New Folder". It starts in Documents/catai. A place itself cannot be the project: select or make a folder in it.
- History lists chats and projects by last use, under day headings (Today, Yesterday, then dates). Each row has an icon (a chat bubble or a folder), a title, and "Chat" or "Project <name>" with the time. No paths.
- Titles: Qwen (the default model) makes a 3 to 6 word title for each chat, from its text. The titles are in `titles.json` in the app data folder. The app makes a title after the agent is done in a chat with no title, and in the background for the 30 newest chats in History (3 at a time). Qwen thinks first, so the request has room for 800 tokens. A title takes about 1 second. Before the title is there, History shows the first line of the chat.
- "Permissions" is the app name for the catatui modes (ask, plan, yolo). The CLI command is still `/mode`. The model and the permissions are one button, "<model> | <permission>", with one menu (Model, Permissions, Options).
- `CATATUI_DESKTOP_USER_DATA` moves the app data (state.json) to a different folder, for tests. Without it, tests change the real app data, also with a different HOME.
- Layout: the header has the app name, the Chats and Projects split buttons, History, and the account. The file tree is full height on the left. The chat and the message box are one column. The message box is flush with the column edges and has a sunken text field.
- Keyboard:
  - The areas are the file tree, the diff, the chat, and the message box. F6 and Shift+F6 move between them.
  - File tree: Up and Down move, Right opens a folder, Left closes it or goes to the parent, Enter adds the file to the chat.
  - Ctrl+D (or Cmd+D) shows or hides the diff of the selected file. In a text field, Ctrl+D keeps its normal meaning.
  - Menus: the first item or the checked item gets the focus. Up and Down move, Enter picks, Escape closes the menu and goes back to its button.
  - Escape goes back: from the diff to the tree, and from the tree or the chat to the message box. In the message box, Escape stops the agent.
- The diff panel is between the file tree and the chat.
- Windows: each window shows one chat, project, or advising session, with its own catatui process. A folder is open in one window only: if another window has it, that window comes to the front. New Window (Cmd+Alt+N) opens a new chat in a new window. In the session menu, each recent row has an "open in a new window" button, and Cmd+click does the same. The History window has "Open in New Window" (Cmd+Enter). At quit, the app saves the open windows (folder, place, size). At the next start, they open again. A folder on the command line opens in one window.
- The window opens at its last place and size. If the screens changed and the title bar is not on a screen, the window opens centered on the main screen.
- Application menu (main.js buildMenu):
  - catai (macOS): About catai, Sign Out, Hide, Quit.
  - File: New Chat (Cmd+N), New Project... (Cmd+Shift+N), New Chat in This Project (Cmd+Alt+N), Open Project... (Cmd+O), Open Recent Project, Show Project in Finder, Close Project (Cmd+Shift+W).
  - Edit: the standard items.
  - View: Show Files (Cmd+B), Next Area (F6), Previous Area (Shift+F6), zoom, full screen, developer tools.
  - Agent: Stop (Cmd+.), Undo Last Request (Cmd+Alt+Z), the permissions (Ask, Plan, Yolo), and the options. The checks show the catatui state.
  - Window, and Help: What catai Can Do (/help) and the catai website.
  - The menu items send an action to the renderer, which does the same thing as the button. The test hook CATATUI_DESKTOP_MENU="Agent>Plan ;; File>New Project..." clicks menu items.
- Undo is on only if there is an undo step. In RPC mode, `undo.ts` sends the number of steps in the status `catatui-undo`.
- At launch, the app opens the folder on the command line, or else the last project (`state.json` in the Electron user data folder). If that folder is gone, it shows the project screen.
- The tree has Windows Explorer style icons (`icons.jsx`): a folder, or a page with a colored label for the file type.
- Buttons have depth (a gradient, a border, and a shadow). They move down when pressed. Menus and the message box are raised cards.
- The account shows the NetID: CatChat names keys `<NetID>_<name>`. For a pasted key, the app gets the alias from `/key/info`. CatChat has no real name: `/key/info` gives only `user_id` (the NetID), and `/user/info` answers "User not found". For a real name, RCI must add it, for example to the App Connect response.
- After an SSO sign-in, the app comes to the front and shows a check mark animation, then starts catatui.
- The file tree (left) lists the project files. In a git repository, `git ls-files` gives the list, so `.gitignore` applies. File names have IntelliJ colors for the git status: green (new or untracked), blue (modified or renamed), red with a line through (deleted). A folder with changes is blue. "Changed only" shows only changed files. A folder that is not a git repository has no colors and no "Changed only".
- The tree header has a refresh icon and a « button that hides the tree. A thin strip with » shows it again.
- The tree has a search field at the top. Each word must be in the path (any case). A search opens all matching folders. Escape clears it. Enter adds the file to the chat if only one file matches.
- A right click on a file shows a native menu: Add to chat, Open, Diff (a modified text file), Show in Finder (Explorer), Copy path, and Copy relative path. A folder has Show in Finder and the copy items.
- A click on a file in the tree selects it. A double click, or a drag into the chat, adds the file to the chat. A drag from Finder or Explorer works too, for files in the project folder (`webUtils.getPathForFile` gives the path). Files outside the project are refused with a notice, because the sandbox blocks them.
- Adding a file sends `[file] <path>` lines and a request: do not read the file now, and reply only "What would you like me to do with this file?". The request says that the file is in the project folder (a model can think that it is an attachment), and to read it later with the tool for its type, not bash. The read tools do not ask for permission.
- The chat shows the `[file]` lines as file cards: a page shape (a vertical rectangle) with a one-line header, the first lines of a text file in small type (like a thumbnail), or a large type icon for a binary file (Excel, Word, PDF). The footer has the size, "Open in Excel" (Word, PowerPoint, ...), which opens the file with the default app of the computer, and "Changes" for a changed file.
- File cards read the file again after each tool, after Undo, and after a refresh, so the preview shows the file now. Image files show as a preview (a data URL, at most 15 MB). The button says "Open in Excel" (Word, PowerPoint) for Office files and "Open" for other files. "Diff" shows only for a text file that git shows as modified.
- The desktop app is named "catai" (the window title and the header). The CLI is still catatui. The header has a larger bobcat. The project path is in a row under the header, with "Open New Folder".
- The message box: the text field on the left. Undo, Send, the model, and the mode on the right, in this order. While the agent works, Send becomes a red Stop button with a spinner.
- History lists the chats of all projects (`SessionManager.listAll`, newest 100), each with its folder. A chat in a different folder opens that project first.
- The chat goes to the bottom after a send or a dropped file.
- The agent text uses Atkinson Hyperlegible (SIL Open Font License, from `@fontsource/atkinson-hyperlegible`), at a larger size. The font is in the app, so it works with no network.
- Chat items do not shrink (`flex-shrink: 0`). Before this, a card that scrolled off got smaller.
- The app icon is `desktop/build/icon.png` (the bobcat on a rounded MSU blue square with a gold rim). In development, `main.js` sets it for the Dock and the window. Packaging makes `.icns` and `.ico` from it.
- "Show changes" shows the file on the right: the diff since the last commit, or since the agent changed it.
- A command question shows the command in an inset box at the top, with a warning that the command can change files on the computer. (A plain-language explanation of commands was tried and removed: it was too complex.) The dialog has the question in a title bar and the buttons in a row. The default button (the first option, Yes) is always on the right, and Enter picks it. "Yes, and do not ask again ..." is a checkbox.
- `CATATUI_DESKTOP_JS` runs JavaScript in the page before the clicks (for tests).
- Sign-out stops catatui and calls `clearSignIn` (the same as `/catchat logout`).
- `CATATUI_DESKTOP_CLICK="a ;; b"` clicks each element before the screenshot. `CATATUI_DESKTOP_WAIT` sets the wait before the prompt (milliseconds).
- `CATATUI_DESKTOP_SNAPSHOT=out.png` runs the app with a hidden window and saves a screenshot. `CATATUI_DESKTOP_PROMPT` sends a prompt first, and `CATATUI_DESKTOP_ANSWER=1` clicks the first option of each dialog. This is for tests.
- The permissions (ask, plan, yolo) and ta last for one catatui session. The app starts catatui again for each chat and project, so it keeps the last values in state.json and sets them again after each start. The CLI does not keep them.
- Fast switch: catatui cannot change its folder, so each chat and project has its own catatui process. The app keeps up to 3 processes. The old process stays when the app moves to another folder, so a switch back is fast. Two seconds after a start, the app starts a process for the one-click switch target (from a chat the last project, from a project the last chat). A process from before a new sign-in stops and starts again.
- Header: one session button on the left, after the app name. It shows "Chat: <name>", "Project: <name>", or "Advising", and has a fixed width. Its menu has two columns:
  - Left: New Chat, New Project..., Advising, and below a line "New catai Window" (Cmd+Alt+N), with their keyboard shortcuts. All Projects... is in the File menu (Cmd+O).
  - Right: the five last chats, projects, and the advising session (one row), and "Show All History..." (Cmd+Y). Each row has an "open in a new window" button with a tooltip.
- New chat screen: the catai brand (logo, name, "Your AI Agent at Montana State University") in the middle. "Continue where you left off" shows the eight last chats, projects, and the advising session as buttons at the top. A click opens one (Cmd+click: in a new window). When the chat starts, the buttons fade away.
- History window: a search field, a type filter (All, Chats, Projects, Advising), and the list by day. Up and Down move, Enter opens, Escape closes.
- Advising view: the "Advising tasks" panel is always on the left (in the place of the file tree). A click on a task sends it. The tasks are off while the agent works. The start screen has a heading, a short description, and a "Demo" note.
- Conversations: in a project, the right side of the project bar has the Conversation menu. The button shows the open conversation. The menu has New Conversation (Cmd+Ctrl+N, also in the File menu) and all conversations in the project, with the time and the number of messages. Point to a conversation to rename it (the app title in titles.json) or delete it (after a question, the session file goes to the trash; the project files do not change). A project opens its last conversation. A conversation is a pi session in the project folder. A chat is a conversation in its own hidden folder.
