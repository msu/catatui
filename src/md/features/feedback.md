# Feature: Feedback

Students send feedback about catatui and catai to the course staff. The client is in `src/catatui/feedback.ts`. The terminal command is in `src/catatui/feedback-command.ts`. The server is the feedback Worker. See [../infrastructure/feedback.md](../infrastructure/feedback.md).

## Client (feedback.ts)

- `feedback.ts` does not import pi, so the desktop app can load it.
- `FEEDBACK_URL`: the env var `CATAI_FEEDBACK_URL`, or the Worker URL (`https://catai-feedback.tight-wave-3e23.workers.dev`).
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

## Desktop (catai)

The main process (`desktop/main.js`) loads `feedback.ts` with jiti, as it loads `store.ts`.

- Help > Send Feedback... opens the form with the kind `feedback`.
- The thumbs-down button on an assistant answer opens the form with the kind `thumbs-down`. The conversation stops at that answer (`get_messages`, cut at the assistant message with the same timestamp).
- The form has a text box and these boxes. Each box is not ticked when the form opens:
  - "Attach this conversation". It shows only if there is a conversation. A preview shows the first 30 lines, and "Show all" expands it.
  - "Attach a screenshot of this window". The main process takes the screenshot before the form is drawn, so the form is not in the image. If the PNG is larger than 4 MB, the main process makes it smaller.
  - "You can contact me (NetID: x)". It shows only if there is a NetID.
- The preview is beside the form (a wide layout). In a narrow window, it goes below the form.
- Send: the main process calls `buildReport` and `sendReport`. The form shows "Thank you. Report <id> sent." or the error. If the send fails, the form keeps the text.
- Nothing goes out before the student clicks Send. The renderer sends only the ticks and the text. The conversation and the screenshot stay in the main process.
