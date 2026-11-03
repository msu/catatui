# Feature: Context View

`/context` shows the context window as a grid, like `/context` in Claude Code. The code is in `src/catatui/context.ts`.

## Decisions

- The grid has 100 cells. Each cell is 1% of the context window of the model.
- The grid shows four parts: system prompt, tools, messages, and free space.
- catatui does not estimate the parts. It sends probe requests to CatChat, and the model server counts the tokens with the model's tokenizer and chat template.
- The probes use `completeSimple` from pi-ai with `maxTokens: 1`, so pi converts the request in the same way as a real request.
- There are three probes, and each probe ends with a user message `.`:
  1. The system prompt. The result is the system prompt part. It also has the chat template and the `.` message, a few tokens.
  2. The system prompt and the active tools. The tools part is probe 2 minus probe 1.
  3. The system prompt, the tools, and the session messages. The messages part is probe 3 minus probe 2.
- The token count is `input + cacheRead + cacheWrite`, because pi-ai puts the cached prompt tokens in `cacheRead`.
- A part with tokens always gets one cell or more, so a small part is visible.

## Subtleties

- The session messages have a copy of the system prompt as a `system` message. Probe 3 removes it, because probe 1 counts the system prompt.
- The probes cost a little CatChat time. Probe 3 sends the full conversation again. The vLLM prefix cache makes it fast after the first request.
- The system prompt is `ctx.getSystemPrompt()`. If an extension changes the system prompt before each request, the probe uses the prompt from the last request.
- If a probe fails, `/context` shows the error and no grid.
