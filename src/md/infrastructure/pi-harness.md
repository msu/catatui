# pi Harness

## Decisions

- catatui is an extension to pi, not a new agent. pi has a terminal UI, tools, sessions, and an extension API for providers, commands, tools, flags, and events.
- `package.json` sets an exact pi version, because catatui uses pi internals. Update pi on purpose, then test.
- `bin/catatui.js` sets the pi agent folder to `~/.catatui`, so a plain pi install keeps its own settings.
- `bin/catatui.js` selects the `msu` theme on a dark terminal and `msu-light` on a light terminal.
- `catatui update` runs the catatui update. Without this, pi runs `pi update`, which does not work for catatui.

## Changes to pi Internals

pi has no public API for these behaviors. If a pi update removes an internal, catatui falls back to the normal pi behavior.

| Internal | File | Change |
|---|---|---|
| `defaultModelPerProvider` | `src/ts/index.ts` | Add `catchat`. Without it, pi shows "no default model is configured" after `/login`. |
| `InteractiveMode.prototype.showWarning` | `bin/catatui.js` | Hide "No models available" and open `/login catchat` at once. |
| `InteractiveMode.prototype.showError` | `bin/catatui.js` | Hide "This operation was aborted" when the student closes the sign-in with Escape. |
