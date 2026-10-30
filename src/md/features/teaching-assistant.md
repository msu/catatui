# Feature: Teaching Assistant

When `ta` is on, the agent explains and gives hints. It does not write the solution. The code is in `src/ts/permissions.ts`.

## Behavior

- catatui adds a teaching-assistant section to the system prompt.
- catatui blocks `edit`, `write`, and http requests other than GET, in all modes, also in `yolo`.
- The agent can show short general examples, but not the solution to the student's task.
- The agent can read files and run commands, for example tests.

## Decisions

- `ta` is a learning aid, not an academic integrity control. The student can turn it off.
- `ta` is off by default.
