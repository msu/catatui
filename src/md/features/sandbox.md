# Feature: Sandbox

The agent can use only files in the folder where catatui started. The code is in `src/ts/sandbox.ts`.

## Behavior

- The sandbox is on by default and applies in all modes, also in `yolo`.
- To turn it off, use `/mode` or `catatui --no-sandbox`.
- File tools (`read`, `write`, `edit`, `grep`, `find`, `ls`): catatui blocks a path outside the folder.
- Shell tools (`bash`, `powershell`): catatui blocks a command that contains a path outside the folder (`/x`, `~`, `$HOME`, `..`, `C:\`).

## Decisions

- The check is a simple text check, not an OS sandbox, because an OS sandbox is different on each platform.

## Subtleties

- The shell check reads only the command text, so a command can get around it. The README tells students this.
- The check uses the real path, so a symbolic link in the project cannot point outside.
- catatui reads `--no-sandbox` at the first start only, so a new session (`/new`) keeps the choice from `/mode`.
