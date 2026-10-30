# Feature: Screen

## Header

The code is in `src/ts/banner.ts` and `src/ts/logo.ts`.

- Terminals with an image protocol (Kitty, iTerm2) show `assets/bobcat-head.png`.
- Other terminals show a pixel-art bobcat, with a checkerboard of half blocks: green on dark terminals, MSU blue and gold on light terminals.
- The pixel art shows bands in some terminal fonts. This is a font problem, and catatui does not fix it.

## Footer

The code is in `src/ts/footer.ts`.

- The footer is one line with short labels: `cwd:`, `model:`, `think:`, `ctx:`, and `mode:`. Students need this information.
- If the line is too long, catatui cuts the start of the folder path, so the other fields stay visible.

## Themes

`themes/msu.json` (dark) and `themes/msu-light.json` (light) use MSU blue and gold.

## Name

The name is "catatui", all lowercase, in the program and in the README.
