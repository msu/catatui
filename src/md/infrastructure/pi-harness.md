# pi Harness

## Decisions

- catatui is an extension to pi, not a new agent. pi has a terminal UI, tools, sessions, and an extension API for providers, commands, tools, flags, and events.
- `package.json` sets an exact pi version, because catatui uses pi internals. Update pi on purpose, then test.
- `bin/catatui.js` sets the pi agent folder to `~/.catatui`, so a plain pi install keeps its own settings.
- `bin/catatui.js` selects the `msu` theme on a dark terminal and `msu-light` on a light terminal.
- `catatui update` runs the catatui update. Without this, pi runs `pi update`, which does not work for catatui.
- `bin/catatui.js` sets `PI_SKIP_VERSION_CHECK=1`, so pi does not show "Update Available ... Run pi update". Students cannot update pi, because `package.json` sets the pi version.
- After a catatui update changes the pi version, pi shows its changelog one time. `bin/catatui.js` sets `lastChangelogVersion` in `settings.json` to the pi version, so pi does not show it. The changelog is about pi, not catatui.
- pi sends one anonymous request with its version to pi.dev at the first start of a new install (`enableInstallTelemetry`). pi also sends it when it shows the changelog, so catatui stops that second request. catatui does not change the first request.

## Changes to pi Internals

pi has no public API for these behaviors. If a pi update removes an internal, catatui falls back to the normal pi behavior.

| Internal | File | Change |
|---|---|---|
| `defaultModelPerProvider` | `src/catatui/index.ts` | Add `catchat`. Without it, pi shows "no default model is configured" after `/login`. |
| `InteractiveMode.prototype.showWarning` | `bin/catatui.js` | Hide "No models available" and open `/login catchat` at once. |
| `InteractiveMode.prototype.showError` | `bin/catatui.js` | Hide "This operation was aborted" when the student closes the sign-in with Escape. |

## Subtleties

- pi shows the extension under `[Extensions]` with the name of the folder that holds `index.ts`. So the folder name is `src/catatui`.
