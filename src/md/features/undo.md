# Feature: Undo

`/undo` puts back the files that the agent changed for the last request. The code is in `src/ts/undo.ts`.

## Behavior

- Before each allowed `edit` or `write`, catatui keeps a copy of the file. It notes a file that did not exist.
- One request is one undo step. catatui keeps 20 steps.
- `/undo` shows the files and asks the student to confirm. It warns if the student changed a file after the agent.
- `/undo` is not available while the agent works.

## Subtleties

- `/undo` does not undo changes from commands. The README tells students to use git.
- The copies stay in memory, so they last for one session only.
- After an undo, catatui tells the model which files changed, with the next request. If not, the model can use old file contents.
