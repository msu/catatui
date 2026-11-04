# Feature: compaction while idle

catatui compacts the context when the student is away, so the next prompt does not wait for a compaction. The code is in `src/catatui/idle-compact.ts`. Only the catatui command loads it (`CATATUI=1`), also in the desktop app.

## Behavior

- When pi is idle (`agent_settled`), a timer starts. A new prompt (`input`), a new run (`agent_start`), or a session change (`session_shutdown`) stops it.
- When the timer ends, if pi is idle and the context is at or above the limit, catatui calls `ctx.compact()`.
- During the compaction, the status `idle-compact` is "Compacting while idle...". After it, a notice gives the context percent before and after.
- If the compaction stops, or there is nothing to compact, there is no notice. Other errors show a notice.
- After a compaction, pi does not know the token count until the next response. So the timer does not compact again.

## Setting

`idleCompaction` in `~/.catatui/settings.json` (or `.pi/settings.json` in the project):

```json
{ "idleCompaction": { "enabled": true, "minutes": 10, "percent": 50 } }
```

- Defaults: on, 10 minutes, 50% of the context window. These numbers are a first guess.
- `false` or `"enabled": false` turns it off. A bad value uses the default.

## Prompts during the compaction

- Terminal: pi keeps the prompt and sends it after the compaction.
- RPC (desktop app): pi refuses a prompt during a compaction. If the `idle-compact` status is set, the app sends `abort` first, then the prompt. The abort stops the compaction, and the context stays as it was.

## Decisions

- The limit (50%): a compaction loses detail. Below the limit, the context is not a problem.
- Each catai project has its own catatui process, so each idle project can compact. The limit keeps this rare.
- If the student does not come back, the summary request is wasted CatChat time.
