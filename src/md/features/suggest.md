# Feature: suggestions in the message box

While the student types, a fast model completes the message. The rest of the message shows in gray after the cursor. Tab accepts it, and Escape hides it. The terminal program and the desktop app both have it.

## Code

- `src/catatui/suggest.ts`: the request, the model, the delay, and the setting. The desktop app loads this file with jiti.
- `src/catatui/suggest-editor.ts`: the terminal editor (`SuggestEditor`) and the `/suggest` command.
- `desktop/main.js` (`suggest` IPC) and `Composer` in `desktop/src/App.jsx`: the desktop message box.

## Behavior

- After a pause of 450 ms in typing, catatui sends the text and the last answer to `gemma4-31B-it`. The answer takes approximately 0.5 s.
- Only when the cursor is at the end of the text, the text has 3 or more characters, and the text is not a `/command` or a `!shell` command.
- A new key removes the suggestion. The request for an old text stops.
- After Tab, a new pause starts a new request. So the student can accept a long message in parts.
- Qwen and gpt-oss think first, so they are too slow for this.

## Terminal

- pi lets one custom editor be active. `SuggestEditor` extends pi's `CustomEditor`, so the app keys and the file and `/command` autocomplete work as before.
- If the autocomplete list is open, Tab and Escape go to the list.
- `render` puts the suggestion in the padding after the cursor, on one line. If there is no space, catatui cuts the suggestion. The label "tab" shows if there is space.
- catatui sets the editor in `session_start`, only in the terminal (`ctx.mode === "tui"`).
- The editor replaces the custom editor of a different extension, if there is one.

## Setting

`"suggest"` in `~/.catatui/catatui.json` (`settings.ts`). On by default.

- Terminal: `/suggest on` or `/suggest off`.
- Desktop app: Settings (catai menu > Settings on macOS, File > Settings on Windows).
- catatui reads the file before each request, so a change is active at once.

## Cost

Each pause sends one CatChat request of at most 40 tokens out.
