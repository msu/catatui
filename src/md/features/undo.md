# Feature: Undo

`/undo` puts back the files that the agent changed for the last request. The code is in `src/catatui/undo.ts`.

## Behavior

- Before each allowed file change (`CHANGE_TOOLS`: `edit`, `write`, `excel_write`, `docx_write`, `move`, `copy`, `delete`, `mkdir`), catatui keeps a copy of each path. It notes a path that did not exist.
- For a folder (`delete` or `move` of a folder), catatui keeps a copy of each file in it, at most 500 files and 50 MB. Above that, `/undo` says that it cannot put back those files.
- For a new path in new folders (for example `mkdir a/b/c`), catatui notes the first new folder, so `/undo` removes all of it.
- One request is one undo step. catatui keeps 20 steps.
- `/undo` shows the files and asks the student to confirm. It warns if the student changed a file after the agent.
- `/undo` is not available while the agent works.

## Subtleties

- `/undo` does not undo changes from commands or from the git tools. The README tells students to use git.
- The copies stay in memory, so they last for one session only.
- After an undo, catatui tells the model which files changed, with the next request. If not, the model can use old file contents.
