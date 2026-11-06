# Feature: Models

The values are in `src/catatui/config.ts`. The model list comes from CatChat (`src/catatui/models.ts`).

## Decisions

- The default model is `Qwen3.8-27B`. It passed all tool-call tests.
- At the start, catatui keeps a model that the student saved with `/model`. If there is none, it uses the first match in `PREFERRED_MODELS`.
- catatui hides alias names that are not the real model (for example "opus"). It also hides embedding models, because they cannot chat.
- `/model` shows a short note for each model: the maker and type, then the result of a small tool-call test on 2026-10-28. The test is a guide only.
- The note is the pi model name. pi 1.5 shows the name after the id in `/model`, so the name does not repeat the id. Ctrl+P model cycling shows the note, not the id.
- CatChat does not give model descriptions, so the notes are written by hand. The README and the website have the same list.
- CatChat does not tell what `muse-glimmer:30b` and `nimble:9b` are. Their notes say "Unknown Model".
- catatui does not change the pi thinking default (`medium`).
- The desktop app shows a green leaf next to `gpt-oss:120b` (`GREEN_MODELS` in App.jsx), in the model lists and on the model button. Its tooltip says "Uses less energy for each answer". This is an estimate, not a measurement: gpt-oss is a mixture-of-experts model with few active parameters for each token. CatChat does not report energy. For real numbers, ask MSU for GPU power data for each model. The CLI does not show the leaf.

## Subtleties

- If CatChat does not give a context window, catatui uses 32768 tokens.
- CatChat reports 983k for Qwen. This value is not confirmed.
- It is not confirmed that CatChat sends the thinking level to the model.
