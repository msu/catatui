# Feature: Modes

The code is in `src/catatui/permissions.ts`. The `/mode` command opens a panel. Space or Enter changes a line. The panel stays open until Escape.

## Behavior

| Mode | Behavior |
|---|---|
| `ask` | The agent asks before each file change, command, and http request. This is the start mode. |
| `plan` | The agent writes `PLAN.md` and changes no other file. It sends only GET requests. |
| `auto` | The agent asks only when an action can do damage. A safety check decides the commands (auto-mode.md). |
| `yolo` | The agent asks nothing. |

`ta`, `sandbox`, and `ste` are options, not modes, because each one works with all modes.

## Decisions

- The modes are like the permission modes in Claude Code.
- `ask` is the start mode, because new users do not know what the agent can do.
- The mode, `ta`, and the "do not ask again" choices last for one session only, so the student starts in a safe state each time.
- `/mode ask`, `/mode plan`, `/mode auto`, and `/mode yolo` set the mode. `/mode ta`, `/mode sandbox`, and `/mode ste` turn an option on or off. Add `on` or `off` to set a value, for example `/mode sandbox off`. The desktop app uses `on` and `off`, so it does not depend on the old value.
- In RPC mode (the desktop app), catatui sends the mode, the options, and their help text as JSON in the status `catatui`. The app builds its mode menu from this. `/mode` adds no notice to the chat in RPC mode, because the menu shows the change.
- The command name is `/mode`, not `/safety` or `/config`, because the panel holds more than safety settings. pi already has `/settings`.

## Subtleties

- The mode and ta are for the catatui process, not for one session. pi loads the extension again for a new session, a resume, or a fork. Before this, a new conversation went back to ask, and the desktop app then saved ask.

"Do not ask again" is not available for these commands:

- Commands that can run other commands (`npx`, `sh`, `python`, `sudo`, and more). If it were available, "do not ask again for npx" allows all programs.
- Commands with `;`, `&`, `|`, a backtick, `$(`, or a newline. A chain can hide a second command after an allowed first word.
- Network programs (`curl`, `wget`, `scp`, `Invoke-WebRequest`, and more). A later command can send data out.
- GET requests with a query of more than 100 characters. The URL can carry data out.

After outside content in a turn (an `http` request, `git_clone`, `git_pull`, or a network program), the ask dialog starts with a warning: text in that content can tell the agent to do harmful things. Auto mode asks for each command until the next student message (auto-mode.md).
- Risky commands: `rm`, `git push`, `git reset`, `chmod`, and `curl | sh`.

The same rules apply to `run`, by program name (run.md).

Other tools:

- `git_restore` and `delete` always ask in ask mode, because they can lose work.
- `git_clone`, `git_pull`, and `git_push` always ask, also in yolo mode, because they get from or send to GitHub (git.md).
- ta and plan mode block the git change tools, `git_clone`, and `git_pull`.
