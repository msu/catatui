# Feature: Feedback

Students send feedback about catatui and catai to the course staff. The client is in `src/catatui/feedback.ts`. The terminal command is in `src/catatui/feedback-command.ts`. The server is the feedback Worker. See [../infrastructure/feedback.md](../infrastructure/feedback.md).

## Client (feedback.ts)

- `feedback.ts` does not import pi, so the desktop app can load it.
- `FEEDBACK_URL`: the env var `CATAI_FEEDBACK_URL`, or a placeholder. The placeholder uses the `.invalid` domain, so a send fails at once. Card-6 gives the real URL.
- `buildReport()` adds the catatui version (`package.json`) and the os (`platform release arch`). It checks the same limits as the Worker, and throws an error in STE.
- `sendReport()` sends `POST /v1/report` with a 30 s timeout. It does not throw. It gives `{ id }` or `{ error }`.
- `netId()`: the part of the CatChat key alias before the first `_`. If it is not a NetID, it gives undefined.
- `conversationText()`: the student and assistant text and the tool calls as markdown. It leaves out thinking and tool results. If the text is larger than 1 MB, it keeps the end.

## Terminal (/feedback)

1. The student types the feedback. If the text is empty, catatui sends nothing.
2. If there is a conversation, catatui asks "Attach this conversation?". The question shows the size and the first lines.
3. If there is a NetID, catatui asks "Can we contact you about this? (sends your NetID: x)".
4. catatui sends the report, then shows "Thank you. Report <id> sent." or the error.

## Decisions

- Nothing goes out before the student answers each question. Escape at a question sends nothing.
- "No" is the first choice in each question, so Enter does not attach private data.
- With no UI (print mode), `/feedback` refuses.
- The conversation and the NetID are opt-in. The version, the os, and the model always go with the report.
