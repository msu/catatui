# Feature: Windows with no Git for Windows

catatui works on a Windows computer with nothing extra installed. The code is in `src/catatui/windows.ts`.

## Behavior

- On Windows, catatui replaces pi's `bash` tool with pi's `powershell` tool at session start (`pi.setActiveTools`). pi's bash tool needs Git Bash. PowerShell is part of Windows.
- The system prompt gets a "Windows" section: use `run`, the file tools, and the git tools first. Write PowerShell, not bash.
- `CATATUI_SHELL=bash` keeps bash, for a student who has Git Bash.
- What works with no installed program:
  - `run`, `move`, `copy`, `delete`, `mkdir` (run.md)
  - the git tools, with dugite's git (git.md)
  - `server`: it starts the command with `cmd.exe`
  - `grep`, `find`: pi downloads `rg` and `fd` at first use

## Decisions

- PowerShell plus purpose-built tools, not a bundled bash. No npm package ships a real bash for Windows. The tools also make the behavior the same on all systems, and they are easier to check (sandbox, permissions).
- macOS and Linux keep bash.

## Subtleties

- A student without PowerShell 7 has Windows PowerShell 5.1. It has no `&&` or `||`. Models often write bash syntax. The prompt section says this, but expect some failed commands.
- The `!` and `!!` commands in the terminal still use bash (pi). Without Git Bash, they fail.
- Not tested on Windows yet. See the test list in `tmp/windows-git-plan.md`.
