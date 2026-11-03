# Feature: Help

`/help` and the header tip. The code is in `src/catatui/help.ts`.

## Decisions

- Students do not know what catatui can do. `/help` shows the capabilities with example prompts, the commands, the keys, and tips.
- pi has no `/help` command, so catatui can use the name.
- The header has a `/help` line, and a "Try:" line with one example prompt. catatui selects the example at random at each start.
- The examples are short, so they fit on the header line.

## Subtleties

- When you add a tool or a command, add it to `/help` and, if useful, to `TIPS`.
- pi removes blank lines from a notice, so `/help` shows the sections with no blank lines between them.
