# Feature: Modes

The code is in `src/catatui/permissions.ts`. The `/mode` command opens a panel. Space or Enter changes a line. The panel stays open until Escape.

## Behavior

| Mode | Behavior |
|---|---|
| `ask` | The agent asks before each file change, command, and http request. This is the start mode. |
| `plan` | The agent writes `PLAN.md` and changes no other file. It sends only GET requests. |
| `yolo` | The agent asks nothing. |

`ta`, `sandbox`, and `ste` are options, not modes, because each one works with all modes.

## Decisions

- The modes are like the permission modes in Claude Code.
- `ask` is the start mode, because new users do not know what the agent can do.
- The mode, `ta`, and the "do not ask again" choices last for one session only, so the student starts in a safe state each time.
- `/mode ask`, `/mode plan`, and `/mode yolo` set the mode. `/mode ta`, `/mode sandbox`, and `/mode ste` turn an option on or off. Add `on` or `off` to set a value, for example `/mode sandbox off`. The desktop app uses `on` and `off`, so it does not depend on the old value.
- In RPC mode (the desktop app), catatui sends the mode, the options, and their help text as JSON in the status `catatui`. The app builds its mode menu from this. `/mode` adds no notice to the chat in RPC mode, because the menu shows the change.
- The command name is `/mode`, not `/safety` or `/config`, because the panel holds more than safety settings. pi already has `/settings`.

## Subtleties

"Do not ask again" is not available for these commands:

- Commands that can run other commands (`npx`, `sh`, `python`, `sudo`, and more). If it were available, "do not ask again for npx" allows all programs.
- Commands with `;`, `&`, `|`, a backtick, or `$(`. A chain can hide a second command after an allowed first word.
- Risky commands: `rm`, `git push`, `git reset`, `chmod`, and `curl | sh`.
