# Feature: Web Tools

The `show_page` and `server` tools. The code is in `src/catatui/web.ts`.

## show_page

The model shows an HTML page in the student's browser, and gets the answers back. Examples: a quiz, a form, a choice, a chart, a step-by-step exercise.

- catatui serves the page on `127.0.0.1` at a random port and a random path. Other web sites cannot guess the path, so they cannot send answers.
- catatui adds a script to the page. The script sends each `<form>` submit to catatui as JSON. A page script can also call `catatui.submit(data)` with any JSON value.
- The tool waits for one answer. It stops after the timeout (10 minutes by default), or when the student presses Escape.
- After the answer, the page shows "Sent to catatui", and the server stops.
- The page can load scripts from a CDN, for example a chart library. Then the page needs the internet.
- `show_page` does not ask for permission. It changes no files and runs no commands on the computer. The page runs in the browser only.

## server

The model starts the student's dev server in the background, for example `npm run dev` or `python app.py`. Then the model tests it with the `http` tool.

- Actions: `start`, `stop`, `logs`, and `list`.
- `start` runs the command in the project folder, waits 3 seconds, and returns the first output and the URLs in the output.
- catatui keeps the last 300 lines of output for each server.
- `stop` stops the command and its child processes: the process group on macOS and Linux, and `taskkill /T` on Windows.
- When catatui stops, it stops all servers, so no server keeps a port.
- `server start` is a command. The ask prompt and the sandbox command check treat it like `bash`. The prompt says "in the background".

## Prompt

- Each tool has `promptGuidelines`. pi adds them to the system prompt only while the tool is active.
- The guidelines tell the model when to use `show_page`, and to use `server` for commands that do not end.

## Subtleties

- The bash tool waits for a command to end. Without `server`, a dev server stops the agent until the timeout.
- `show_page` opens the browser with `open` (macOS), `start` (Windows), or `xdg-open` (Linux). If no browser opens, the notice and the tool result show the URL.
- Not tested on Windows: `taskkill` and `start`.
