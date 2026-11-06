# Feature: Screen

## Header

The code is in `src/catatui/banner.ts` and `src/catatui/logo.ts`.

- Terminals with an image protocol (Kitty, iTerm2) show `assets/logo.png`.
- Other terminals show a pixel-art logo, with a checkerboard of half blocks: green on dark terminals, MSU blue and gold on light terminals.
- The pixel art shows bands in some terminal fonts. This is a font problem, and catatui does not fix it.

## Footer

The code is in `src/catatui/footer.ts`.

- The footer is one line with short labels: `cwd:`, `model:`, `think:`, `ctx:`, and `mode:`. Students need this information.
- If the line is too long, catatui cuts the start of the folder path, so the other fields stay visible.

## Themes

`themes/msu.json` (dark) and `themes/msu-light.json` (light) use MSU blue and gold.

## Thinking

- catatui hides the model's thinking blocks by default. Students need the answer, and the thinking is long. Ctrl+T shows the thinking.
- pi has no option for this default, so `bin/catatui.js` writes `"hideThinkingBlock": true` to `~/.catatui/settings.json` before pi starts.
- catatui writes the value only if the key is not in the file. pi writes the key only when the student presses Ctrl+T, so catatui does not change the student's choice.

## Name

The name is "catatui", all lowercase, in the program and in the README.
