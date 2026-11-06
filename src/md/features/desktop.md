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

## Demo mode

- `--demo-mode` on the command line turns on the mock-data parts for a demo: Advising, Classes, and the student profile. Without it, these parts are off.
- main.js: `DEMO`. It sets `CATAI_DEMO=1` for catatui. It hides File > Advising and File > Classes, refuses the `advising` and `classes` requests, and removes the Advising and Classes sessions from the session lists, the saved windows, and the warm process.
- catatui: `CATAI_DEMO=1` loads `open_view` (views.ts) and adds the app areas to the app prompt (widget.ts). Without it, the model does not know about these areas.
- Renderer: `info.demo` shows the Advising and Classes items in the session menu. `info.profile` is the mock profile (`src/catatui/profile.ts`).
- Account menu in demo mode: a wide panel with four columns: the student (name, standing, major, college, ID) and the sign-ins, the contacts (advisor, department chair, dean, with email, office, and office hours), the account balance, and the university events. The email addresses use `example.montana.edu`, so a click does not send mail to a real person. The advising tools use the same profile.
- The windows installer (`docs/catai/install.ps1`) makes a shortcut without `--demo-mode`.

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
- The main process keeps a copy of each file before the first change in the chat: at `tool_execution_start` of a tool in `CHANGE_TOOLS` (config.ts). "Changes" compares the file now with the last commit (git), or with this copy. So after `/undo`, or a change by the student, the changes are correct.
- Changes are in the side panel, not in a separate panel. A file tab with changes has a "Changes" button. For a text file, the editor shows a merge view (`@codemirror/merge`, `unifiedMergeView`): each changed block shows the old lines in red above the new lines, with "Revert" (back to the old text, then autosave, so a student can undo one change of the agent) and "Keep" (hide the block). Unchanged lines collapse. While the agent works, Revert and Keep do nothing.
- A file with a zero byte in its first 8 KB is binary (Excel and Word files are zip files). Binary files and files over 300 KB have no text diff: "Changes" shows a note and "Roll back..." (the same question as the tree menu).
- "Open the file" opens only files in the project, with the normal app for the file type.
- Limits: the panel does not show changes from bash commands. For an old chat that the student opens again, the list starts empty.
- Chat and Project. The app starts in Chat. A chat is a project in a hidden folder, `Documents/catai/Chats/<date time>`, with the same tools (also code), but with no file tree and no path row. The header has a Chat and Project switch. The Chats button shows the name of the open chat (or the last chat). The Projects button shows the name of the open project (or the last project). Both buttons have a fixed width, and a long name ends in "...". In a project, the path row shows "Project Directory:" and the path (a click opens the project screen). Chats and Projects are split buttons. A click on the main part moves to the last chat or the last project (the folder picker if there is no project). The arrow opens a menu: Chats has "New chat" and the five last chats. Projects has "New project...", "New chat in this project" (in a project only), the five last projects, and "All projects...". History on the right shows all chats and projects.
- At launch the app reuses the newest chat folder if it is empty and has no chat, so launches do not leave empty folders.
- If the app was last in a project, the empty chat shows "Resume project <name>". `state.json` has `lastProject` and `lastKind`.
- The Project tab is a menu: "New project...", the five last projects, and "All projects...". "New project..." opens "Select A Folder For Your Project", a folder picker in the app. It has places on the left (catai projects, Documents, Desktop, Downloads, Home), the folders on the right, and "New Folder". It starts in Documents/catai. A place itself cannot be the project: select or make a folder in it.
- History lists chats and projects by last use, under day headings (Today, Yesterday, then dates). Each row has an icon (a chat bubble or a folder), a title, and "Chat" or "Project <name>" with the time. No paths.
- Titles: Qwen (the default model) makes a 3 to 6 word title for each chat, from its text. The titles are in `titles.json` in the app data folder. The app makes a title after the agent is done in a chat with no title, and in the background for the 30 newest chats in History (3 at a time). Qwen thinks first, so the request has room for 800 tokens. A title takes about 1 second. Before the title is there, History shows the first line of the chat.
- "Permissions" is the app name for the catatui modes (ask, plan, auto, yolo). The CLI command is still `/mode`. The model and the permissions are one button, "<model> | <permission>", with one menu (Model, Permissions, Options).
- `CATATUI_DESKTOP_USER_DATA` moves the app data (state.json) to a different folder, for tests. Without it, tests change the real app data, also with a different HOME.
- Layout: the header has the app name, the Chats and Projects split buttons, History, and the account. The file tree is full height on the left. The chat and the message box are one column. The message box is flush with the column edges and has a sunken text field.
- Keyboard:
  - The areas are the file tree, the side panel, the chat, and the message box. F6 and Shift+F6 move between them.
  - File tree: Up and Down move, Right opens a folder, Left closes it or goes to the parent, Enter adds the file to the chat.
  - Ctrl+D (or Cmd+D) opens the selected file in the side panel with "Changes" on. In a text field, Ctrl+D keeps its normal meaning.
  - Menus: the first item or the checked item gets the focus. Up and Down move, Enter picks, Escape closes the menu and goes back to its button.
  - Escape goes back: from the tree or the chat to the message box. In the message box, Escape stops the agent.
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
- The file tree (left) lists the project files. In a git repository, `git ls-files` gives the list, so `.gitignore` applies. File names have IntelliJ colors for the git status: green (new or untracked), blue (modified or renamed), red with a line through (deleted). A folder with changes is blue. "Changed only" shows only changed files. A folder that is not a git repository has no colors and no "Changed only". The app runs git from the dugite package with the safety settings of git.ts, so the student does not need git. A repository with risky settings (git.md) shows no git status.
- The tree header has a refresh icon and a « button that hides the tree. A thin strip with » shows it again.
- The tree has a search field at the top. Each word must be in the path (any case). A search opens all matching folders. Escape clears it. Enter adds the file to the chat if only one file matches.
- A right click on a file shows a native menu: Add to chat, Open, Diff (a modified text file), Show in Finder (Explorer), Copy path, and Copy relative path. A folder has Show in Finder and the copy items.
- A click on a file in the tree selects it. A double click (or Enter, or "Open") opens it in catai, in the side panel: the editor for a text file, else a read-only view. A drag into the chat, or "Add to Chat" in the right-click menu (for the keyboard and screen readers), adds the file to the chat.
- The tree is resizable: drag its right edge, or focus the edge and use the Left and Right arrow keys (160 px to 50% of the window). A double click on the edge gives the default width. The width is kept (localStorage "treeWidth").
- Delete: the Delete or Backspace key on a row of the tree, or "Move to Trash..." in the right-click menu. main.js shows a native warning first ("Move X to the Trash?", Cancel is the default), then moves the item to the Trash (the Recycle Bin on Windows) with `shell.trashItem`, so the student can get it back. Open tabs of the item close. The agent gets a hidden note (`/catai-deleted`, moved.ts).
- Get a project from GitHub: "From GitHub..." in the project picker, or "Or get a project from GitHub" in its empty state. The dialog takes an address (`user/repo`, a github.com page address, or `git@github.com:user/repo`; other hosts only https) and, if the student is signed in to GitHub, lists their repositories (newest first, with a search). main.js (`clone-project`) clones into a new folder in the picker's folder with the safe git setup (git.ts: no hooks, no SSH; the catai token only for github.com), then the project opens. A progress bar shows the clone: `git clone --progress` writes its phases to stderr, `cloneProgress` (github.ts) makes one percent from them (preparing 0-5, downloading 5-85, unpacking 85-95, writing files 95-100), and main.js sends "clone-progress" events to the dialog. A failed clone removes the folder. A repository with an AGENTS.md gives the agent its instructions at once, so an instructor can ship them in a template repository. Tested: a clone of octocat/Hello-World. Not tested yet: the repository list and private repositories.
- Git in the tree (git is never required; the items show only when they apply):
  - No git: "Initialize Git..." in the right-click menu. A native question explains git first. Then `git init -b main`, and a `.gitignore` (node_modules, .DS_Store, Python caches) if there is none.
  - Git: "Commit All Changes..." in the menu, and a "Commit..." button in the tree header when files changed. A dialog asks for a message, then `git add --all` and `git commit` with the safe git setup (git.ts). The author is the git setting, else the GitHub sign-in, else the computer user (the same as gittools.ts). "Roll Back to Last Commit..." stays on changed files.
- File action names: "Open" is in catai. "Open in Excel" (Word, PowerPoint) or "Open in Default App" is outside catai. "Launch" runs an HTML page or a web app in the web preview.
- Adding a file sends `[file] <path>` lines and a request: do not read the file now, and reply only "What would you like me to do with this file?". The request says that the file is in the project folder (a model can think that it is an attachment), and to read it later with the tool for its type, not bash. The read tools do not ask for permission.
- The chat shows the `[file]` lines as file cards: a page shape (a vertical rectangle) with a one-line header, the first lines of a text file in small type (like a thumbnail), or a large type icon for a binary file (Excel, Word, PDF). The footer has the size and the file buttons.
- File cards read the file again after each tool, after Undo, and after a refresh, so the preview shows the file now. Image files show as a preview (a data URL, at most 15 MB). 
- File buttons (`FileButtons`, the `FileActions` context in App.jsx). The same actions are on the file card, in the side panel panes, and in the right-click menu of the tree:
  - Launch: only for an HTML file (it opens in the web preview) and for the entry file of a server app (`package.json`, `manage.py`, or the Flask file; it opens the preview with "Start").
  - Open: the default app of the computer. Office files say "Open in Excel" (Word, PowerPoint).
  - Open: the file in catai, in the side panel (the editor, or a read-only view).
  - Changes ("Show Changes" in the tree menu): only for a text file that git shows as modified. It opens the file in the side panel with "Changes" on. On file cards, "Open in Default App" is an icon button (Office files keep "Open in Excel"), so the buttons fit in one row.
  - A pane leaves out its own actions: the file pane has no Open and no Diff (it has "Changes"), and the web preview has no Launch.
- The right-click menu of the tree also has:
  - "New": a submenu with Folder and the kinds of files that catai understands (`NEW_KINDS` in `src/catatui/newfile.ts`): Markdown, Text, HTML, CSS, JavaScript, Python, JSON, Excel, CSV, and Word. A dialog asks for the name. main.js adds the extension, refuses a name that is there already, and writes a small start file. The HTML and Word files have a title, a language, and a heading. Then the file opens in the side panel.
  - "Open in Terminal": Terminal on macOS, PowerShell on Windows, and `x-terminal-emulator` on Linux, in the folder (or the folder of the file).
  - A right click on the empty part of the tree gives the menu of the project folder.
  - An empty project shows "This project has no files yet", a gold "New File" button (the "New" kinds as a menu), and "Or ask catai to make something".
  - catai does not make AGENTS.md by itself: an empty one gives the agent nothing, and a file that the student did not make is confusing. "New > Instructions for catai (AGENTS.md)" makes it in the project folder with a short template, with no name dialog. If it is there already, it opens. pi reads it at the start of a chat.
  - If AGENTS.md changes, is made, or is deleted during a chat, the next turn uses the new text (`src/catatui/agentsfile.ts`, also in the CLI). It changes `systemPromptOptions.contextFiles` in `before_agent_start` and adds a hidden note "The student changed AGENTS.md". Tested: a chat answered "apple", then "banana" after a change to the file.
  - The tree shows empty folders (`emptyDirs` from main.js), so a new folder is visible. Not in a search or with "Changed only".
- Drag and drop in the tree moves a file or a folder into a folder (a folder row, the folder of a file row, or the empty part of the tree for the project folder). main.js (`file-move`) does not replace an item and does not move a folder into itself.
  - After a move, the chat shows a notice, and the app sends `/catai-moved [{from, to}]` (`src/catatui/moved.ts`). The command queues a hidden note with `deliverAs: "nextTurn"`, so the agent gets the new paths with the next message of the student. It does not start a turn.
  - The note is in memory only. If the app closes before the next message, the agent does not get it.
- The text editor (`desktop/src/editor.jsx`, CodeMirror 6, `src/catatui/editor.ts`):
  - "Open" on an HTML, CSS, JS, TS, JSON, Markdown, Python, CSV, or TXT file opens an editor with syntax highlighting, line numbers, search, and undo. Other files stay read-only previews.
  - Autosave: 1 second after typing stops, when the editor loses the focus, and when it closes. A save sends the text that the editor loaded or saved last. If the file on disk is different (another app changed it), main.js (`file-write`) writes nothing, and a bar asks "Reload" or "Keep mine".
  - No overwrites between the student and the agent: when the agent starts, the editor saves at once and then locks ("catai is working"). The agent changes the open file only with `editor_edit`: the app applies the edits to the document (one undo step, so Cmd+Z undoes it) and saves. `edit` and `write` on the open file are blocked. `editor_edit` is a change tool (CHANGE_TOOLS), so ask mode, plan mode, the sandbox, and /undo treat it like `edit`.
  - Context: the agent always knows the file in front of the student. A read-only view sends `/catai-editor {path, readOnly: true}` (the file name only, no editor_edit). The editor sends `/catai-editor {path, line, selection}` when the open file, the cursor line, or the selection changes. Before each turn, the agent gets an `editor` section: the file, the line, the selected text (at most 2,000 characters), and "use editor_edit".
  - A student save sends one `/catai-edited` note for each file until the next agent turn ("read it again before you change it"). The agent's own edits do not.
  - Tested: the student typed a line, autosave wrote it, the agent changed the h1 with editor_edit, and the file had both changes.
- Drag and drop from Finder or Explorer (`file-import` in main.js):
  - On the tree: a copy in the folder under the mouse (or the project folder). A file that is in the project already moves there. The agent gets a hidden note with the next message (`/catai-added`, moved.ts).
  - Anywhere else in the window: a copy in the project folder, then the file goes into the chat as a file card. A folder is copied, but it does not go into the chat.
  - The original stays where it was. A name that is there already gets " copy" (" copy 2", ...), like Finder. catai does not copy a folder that has the project in it.
  - A window listener catches drops outside the chat and the tree, because Chromium opens a dropped file in the window.
- The desktop app is named "catai" (the window title and the header). The CLI is still catatui. The header has a larger bobcat. The project path is in a row under the header, with "Open New Folder".
- The message box: the text field on the left. Undo, Send, the model, and the mode on the right, in this order. While the agent works, Send becomes a red Stop button with a spinner.
- History lists the chats of all projects (`SessionManager.listAll`, newest 100), each with its folder. A chat in a different folder opens that project first.
- The chat goes to the bottom after a send or a dropped file.
- The agent text uses Atkinson Hyperlegible (SIL Open Font License, from `@fontsource/atkinson-hyperlegible`), at a larger size. The font is in the app, so it works with no network.
- Chat items do not shrink (`flex-shrink: 0`). Before this, a card that scrolled off got smaller.
- The app icon is `desktop/build/icon.png` (the bobcat on a rounded MSU blue square with a gold rim). In development, `main.js` sets it for the Dock and the window. Packaging makes `.icns` and `.ico` from it.
- "Show changes" opens the file in the side panel with "Changes" on: the changes since the last commit, or since the agent changed it.
- A command question shows the command in an inset box at the top, with a warning that the command can change files on the computer. (A plain-language explanation of commands was tried and removed: it was too complex.) The dialog has the question in a title bar and the buttons in a row. The default button (the first option, Yes) is always on the right, and Enter picks it. "Yes, and do not ask again ..." is a checkbox.
- `CATATUI_DESKTOP_JS` runs JavaScript in the page before the clicks (for tests).
- Sign-out stops catatui and calls `clearSignIn` (the same as `/catchat logout`).
- `CATATUI_DESKTOP_CLICK="a ;; b"` clicks each element before the screenshot. `CATATUI_DESKTOP_WAIT` sets the wait before the prompt (milliseconds).
- `CATATUI_DESKTOP_SNAPSHOT=out.png` runs the app with a hidden window and saves a screenshot. `CATATUI_DESKTOP_PROMPT` sends a prompt first, and `CATATUI_DESKTOP_ANSWER=1` clicks the first option of each dialog. This is for tests.
- The permissions (ask, plan, auto, yolo) and ta last for one catatui session. The app starts catatui again for each chat and project, so it keeps the last values in state.json and sets them again after each start. The CLI does not keep them.
- Fast switch: catatui cannot change its folder, so each chat and project has its own catatui process. The app keeps up to 3 processes. The old process stays when the app moves to another folder, so a switch back is fast. Two seconds after a start, the app starts a process for the one-click switch target (from a chat the last project, from a project the last chat). A process from before a new sign-in stops and starts again.
- Header: one session button on the left, after the app name. It shows "Chat: <name>", "Project: <name>", or "Advising", and has a fixed width. Its menu has two columns:
  - Left: New Chat, New Project..., Advising, and below a line "New Window" (Cmd+Alt+N), with their keyboard shortcuts. All Projects... is in the File menu (Cmd+O).
  - Right: the five last chats, projects, and the advising session (one row), and "Show All History..." (Cmd+Y). Each row has an "open in a new window" button with a tooltip.
- New chat screen: the catai brand (logo, name, "Your AI Agent at Montana State University") in the middle. "Continue where you left off" shows the eight last chats, projects, and the advising session as buttons at the top. A click opens one (Cmd+click: in a new window). When the chat starts, the buttons fade away.
- History window: a search field, a type filter (All, Chats, Projects, Advising), and the list by day. Up and Down move, Enter opens, Escape closes.
- Advising view: the "Advising tasks" panel is always on the left (in the place of the file tree). A click on a task sends it. The tasks are off while the agent works. The start screen has a heading, a short description, and a "Demo" note.
- Conversations: in a project, the right side of the project bar has the Conversation menu. The button shows the open conversation. The menu has New Conversation (Cmd+Ctrl+N, also in the File menu) and all conversations in the project, with the time and the number of messages. Point to a conversation to rename it (the app title in titles.json) or delete it (after a question, the session file goes to the trash; the project files do not change). A project opens its last conversation. A conversation is a pi session in the project folder. A chat is a conversation in its own hidden folder.
- Classes: the session menu and File > Classes (Cmd+Shift+C) open the Classes overview. Each class has its own chat, which can link to a project. See classes.md.
- Remove sensitive information (main.js "redact-session", redact.js):
  - Point to a message or a tool call and click the trash icon: its text becomes "[removed]". For a tool call, the result and the arguments (except "path") become "[removed]".
  - Select text in the chat, right-click, and click "Remove from This Conversation...": each copy of the text in the session becomes "[removed]" (messages, thinking, tool calls and results, summaries).
  - The app asks first. It changes the session file and keeps each entry, its id, and its parent, so the session tree stays correct. Then catatui loads the session again, and the model does not see the old text. The title is made again.
  - pi has no API for this. pi's "context_edit" entry keeps the old text in the file, so the app does not use it. If pi changes the session format, check this code.
  - The text already went to CatChat when the student sent it. The app says that this does not remove it there.
- Delete a conversation (Conversation menu and History window): "Move to Trash" or "Delete Permanently". A conversation that is open in another window cannot be deleted. Test hook: CATATUI_DESKTOP_YES=<button index> answers these questions.
- Side panel (right): tabs with pinned files and the web preview. Drag its left edge to change the width (kept in localStorage).
  - Open a file that catai cannot edit: double click, "Open" on a file card, or in the tree's right-click menu. The pane shows the whole file with line numbers (or the image, or the Excel grid), and reads it again after each change and when the window gets the focus (the student can have changed the file in Excel or an editor). The pane is read-only: the bar has a "Read-only" badge, "Open in Excel" (Word, PowerPoint) is the gold button, and a click on an Excel cell shows a short read-only note. Buttons: "Show In Project" (it opens the folders of the file in the tree, selects the file, and flashes it) and the file buttons.
  - Remove a file card: the x button on the card. It removes the message from the conversation (the same as "Remove"). A removed message shows as "Removed".
  - The side panel closes when the window moves to another folder (another project, a chat, or a closed project).
  - A show_preview tool card has "Show preview", which opens the page again.
  - Web preview: "Launch" (file buttons), View > Web Preview (Cmd+Shift+P), or the agent's show_preview tool (preview.ts). It is an Electron webview with no preload, no Node, a sandbox, and only http, https, and file pages (main.js "will-attach-webview"). It reloads each time the agent is done. Tools opens the page's developer tools.
  - The menu item shows only for a project with a web app (webapp.js, in the "file-tree" result):
    - An npm app with a "dev" or "start" script and a known server tool (Vite, Next.js, Astro, Express, and others), Django (manage.py), or Flask. The pane shows "Start <command>": the agent starts the app with the server tool (it asks first), then opens it with show_preview. A second button opens the default port, if the app runs now.
    - A static site: the HTML files of the project (not node_modules or build output), index.html first.
  - The preview shows only this project: localhost addresses and project files. The address bar refuses other sites. A link to another site in the page opens in the normal browser (main.js "will-navigate").
- Suggestions in the message box: the rest of the message in gray with a "Tab" label. Tab accepts it, Escape hides it. See [suggest.md](suggest.md).
- Settings (catai menu > Settings, Cmd+,; File > Settings on Windows): a wide window with the suggestion setting and the idle compaction setting side by side. The window writes `catatui.json` (settings.ts, `get-settings` and `set-setting` IPC). A change saves at once. A running catatui process reads the file the next time it needs the setting.
- Areas from the chat: the open_view tool (views.ts) shows a card with a button that opens Advising, Classes, or one class chat. In demo mode only, the app prompt (`appPrompt` in widget.ts) lists the areas and their data, so the model offers the button when the student asks about grades, the transcript, requirements, classes, or due dates. The student clicks the button; the tool does not switch by itself.
- Thinking level: the model button's menu has a "Thinking" slider under the model list, with one stop for each level that the model supports (off, minimal, low, medium, high). A click on a level name also sets the level. Shift+Tab in the message box and Agent > Next Thinking Level (Cmd+Shift+T) go to the next level, like Shift+Tab in the terminal. Agent > Thinking has the levels too. The button shows the level when it is not medium. The app keeps the level in state.json with the permissions and sets it after each catatui start.
  - pi sends the level as reasoning_effort. On CatChat, gpt-oss follows it (low: about 900 thinking characters, high: about 4900). Qwen does not change (measured 2026-11-03).
- Queued messages: a message sent while the agent works waits in pi's queue (followUp). The chat shows it at the end, faded with a dashed border, and "Queued: this message waits until the agent is done. Edit". Edit takes the queued messages back into the message box (pi clear_queue). When the agent takes a message, it moves into the chat. Stop takes the queued messages back first, so pi does not send them after the stop.
- App-only tools: the app starts catatui with `CATAI=1`. Only then catatui loads new_project, show_widget, show_preview, open_view, and the app prompt. The CLI does not load them.
- GitHub: the account menu shows the GitHub sign-in for the git tools: "Sign in to GitHub..." opens a window that opens the GitHub token form and takes the pasted token (main.js "github-sign-in", github.ts). The renderer never gets the token. Two weeks before the token expires, the menu shows "New token...".
