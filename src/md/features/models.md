# Feature: Models

The values are in `src/ts/config.ts`. The model list comes from CatChat (`src/ts/models.ts`).

## Decisions

- The default model is `Qwen3.8-27B`. It passed all tool-call tests.
- At the start, catatui keeps a model that the student saved with `/model`. If there is none, it uses the first match in `PREFERRED_MODELS`.
- catatui hides alias names that are not the real model (for example "opus"). It also hides embedding models, because they cannot chat.
- `/model` shows a short note for each model. The notes come from a small tool-call test on 2026-10-28, so they are a guide only.
- catatui does not change the pi thinking default (`medium`).

## Subtleties

- If CatChat does not give a context window, catatui uses 32768 tokens.
- CatChat reports 983k for Qwen. This value is not confirmed.
- It is not confirmed that CatChat sends the thinking level to the model.
