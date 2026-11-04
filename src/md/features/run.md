# Feature: run and the file tools

Tools that do the common shell jobs with no shell, the same on Windows, macOS, and Linux. The code is in `src/catatui/run.ts` and `src/catatui/files.ts`.

## run

- Starts a program with a list of arguments, for example `{ program: "python", args: ["main.py"] }`. Optional: `input` (stdin) and `timeout` (seconds, default 120, max 600).
- No shell: no pipes, no `&&`, no wildcards, no variables. An argument with spaces is one argument.
- Gives the exit code and the output (stdout and stderr together). For long output, it keeps the last 30,000 characters.
- Escape (abort) and the timeout stop the program and its child processes (`taskkill /T` on Windows, the process group on macOS and Linux).
- Blocked programs: `ssh`, `scp`, `sftp` (the student's keys), `git` (use the git tools), and shells (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`).
- Permissions: like bash, by program name. The student can allow a program for the session, but not a runner (`python`, `py`, `node`, `npx`, and the others in `RUNNERS`), and not a risky command (`RISKY`).
- Sandbox: the program and each argument (also after `=`) that looks like a path must be in the project. A full program path outside the project (for example `/usr/bin/python3`) is blocked. Use the program name.

## File tools

- `move`, `copy`: `from` and `to`. `to` is the full new path, and it must not exist. A folder cannot go into itself.
- `delete`: a file, or a folder with all its files. Not the project folder.
- `mkdir`: a folder and the folders above it.
- They are in `CHANGE_TOOLS` (config.ts). `toolPaths` gives their paths to the sandbox, permissions, undo, and the desktop app diff.
- Permissions: like a file change. `delete` always asks.
- `/undo` (undo.ts) keeps a copy of each file in a changed folder, at most 500 files and 50 MB. Above that, `/undo` says that it cannot put back that folder. For a new path in new folders, undo removes the first new folder.

## Decisions

- `cross-spawn` starts the program. Reason: on Windows, `npm` and `npx` are `.cmd` files, and Node refuses to start `.cmd` and `.bat` files without a shell (a 2024 security change). cross-spawn starts them through `cmd.exe` with correct quotes.
- `to` must not exist. Reason: "move into a folder" and "overwrite" are different in each shell, and models confuse them.
