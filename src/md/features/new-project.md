# Feature: New Project

The `new_project` tool makes a new project folder for a new, separate task, and moves the work there. The code is in `src/catatui/project.ts`.

## Decisions

- Example: the student says "I want to plan my semester" in a code project. The model offers a new project. The tool guidelines tell the model to use it only for work that does not belong in the current project.
- The tool always asks the student, also in yolo mode, because it makes a folder outside the project.
- The folder is `Documents/catai/<name>`. Documents is a folder that students know, and backups include it. The name has only letters, digits, spaces, dots, `-`, and `_`. If the folder exists, the tool adds 2, 3, and so on.
- The tool writes `README.md` with the goal, so the new project has the context.
- Desktop app: catatui cannot change its own folder while it runs. The tool sets the status `catatui-switch` (JSON with the path and the goal). When the agent is done, the app opens the folder (this starts catatui there) and sends the goal to a new chat.
- CLI: the tool tells the student to quit, `cd` to the folder, and start catatui.

## Subtleties

- The sandbox does not check `new_project`, because it has no `path` parameter. The approval question is the control.

- Only in the desktop app: the app starts catatui with `CATATUI_APP=1`, and only then catatui loads this tool. The CLI is for experts in a terminal or an editor, so it does not load it.
