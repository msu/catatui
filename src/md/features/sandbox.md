# Feature: Sandbox

The agent can use only files in the folder where catatui started. The code is in `src/catatui/sandbox.ts`.

## Behavior

- The sandbox is on by default and applies in all modes, also in `yolo`.
- To turn it off, use `/mode` or `catatui --no-sandbox`.
- File tools (`read`, `write`, `edit`, `grep`, `find`, `ls`): catatui blocks a path outside the folder.
- Shell tools (`bash`, `powershell`): catatui blocks a command that contains a path outside the folder (`/x`, `~`, `$HOME`, `..`, `C:\`).
- File change tools (`move`, `copy`, `delete`, `mkdir`): catatui checks each path (`toolPaths` in config.ts), for example both `from` and `to`.
- `run`: catatui checks the program and each argument that looks like a path, also after `=`. There is no shell, so this check is exact for the arguments. A program can still open other files itself.
- git tools: catatui checks `path`, `paths`, and `folder`. gittools.ts also refuses a repository that starts outside the folder.

## Decisions

- The check is a simple text check, not an OS sandbox, because an OS sandbox is different on each platform.

## Subtleties

- The shell check reads only the command text, so a command can get around it. The README tells students this.
- The check uses the real path, so a symbolic link in the project cannot point outside. For a new file, the check uses the real path of the nearest folder that exists, so a new file in a linked folder outside the project is blocked too.
- catatui reads `--no-sandbox` at the first start only, so a new session (`/new`) keeps the choice from `/mode`.
