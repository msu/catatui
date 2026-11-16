# Feedback Worker

Students send feedback from catai (desktop) and catatui (terminal) to one Cloudflare Worker. The reports are for the course staff only. There is no dashboard page and no Discord message. To read the reports, use `wrangler d1 execute --remote`.

The code is in `feedback/`. It has its own `package.json` and `wrangler.toml`. It is not in `scripts/release-files.txt`, so it stays private.

## API

`POST /v1/report` with a JSON body:

```
{ v: 1, app: "catai" | "catatui", version: string, os: string, model?: string,
  kind: "feedback" | "thumbs-down" | "error", text: string (<= 5000 chars),
  error?: string (<= 64 KB, UTF-8 bytes),
  conversation?: string (markdown, <= 1 MB), contact?: string (NetID, <= 64, [A-Za-z0-9._-]),
  screenshot?: string (base64 PNG, <= 4 MB decoded) }
```

- `version`, `os`, and `model` have at most 128 characters.
- The body has at most 7 MB.
- `text` must not be empty, but for the kind `error` it can be empty.
- `error` has the message, the stack trace, and the last lines of the catatui stderr output. For the kind `error`, it is necessary (400 if it is missing or empty).
- The client sends an error report only when the student asks for it. Nothing goes out automatically.
- `conversation`, `contact`, and `screenshot` are opt-in. The client sends them only if the student agrees.

Responses:

- 200: `{ id }`. The id is `crypto.randomUUID()`.
- 400: `{ error }`. A field is not correct.
- 413: `{ error }`. A field or the body is too large.
- 429: `{ error }`. The IP address sent 10 reports in the last hour.
- 404: a different method or path.
- 500: the server has no `IP_SALT`, or D1 or R2 failed.

There is no CORS, because the clients are Node and the Electron main process, not web pages.

## Storage

- D1 database `catai-feedback`, binding `DB`. The schema is in `feedback/schema.sql`.
  - `reports(id, created, app, version, os, model, kind, text, error, conversation, netid, screenshot_key)`. `created` is ISO 8601 UTC.
  - Migrations are in `feedback/migrations/`. `0001_error.sql` adds the `error` column to a database that has the first schema.
  - `hits(ip_hash, at)`: one row for each saved report. `at` is in milliseconds.
- R2 bucket `catai-feedback-shots`, binding `SHOTS`. A screenshot is `screenshots/<id>.png` with the content type `image/png`.

## Rate Limit

- 10 reports for each IP address in one hour.
- `ip_hash` is SHA-256 of `IP_SALT`, ":", and the `CF-Connecting-IP` header. The Worker does not store the plain IP address.
- Each request deletes the hits that are older than 1 day.
- Only a saved report adds a hit. A bad request does not add a hit.

## Code and Tests

- `feedback/src/index.ts`: `handle(request, env)` is a pure function. The default export calls it.
- `feedback/test/handle.test.ts`: tests with fake `DB` and `SHOTS` objects, with no Cloudflare packages. The root `npm test` runs them.

## Deploy

The steps are for the course staff, in `feedback/`:

1. Run `npm install`.
2. Run `npx wrangler login`.
3. Run `npx wrangler d1 create catai-feedback`. Put the database id in `wrangler.toml`.
4. Run `npx wrangler r2 bucket create catai-feedback-shots`.
5. Run `npx wrangler d1 execute catai-feedback --remote --file schema.sql`.
6. Run `npx wrangler secret put IP_SALT`. Use a long random value.
7. Run `npx wrangler deploy`. Put the URL in `src/catatui/feedback.ts`.

For a database that exists, run each new migration before you deploy the Worker that uses it:

- `npx wrangler d1 execute catai-feedback --remote --file migrations/0001_error.sql`

A new database gets all the columns from `schema.sql`. Do not run the migrations on it.

## Query

- The last 20 reports:
  `npx wrangler d1 execute catai-feedback --remote --command "SELECT id, created, app, kind, netid, text FROM reports ORDER BY created DESC LIMIT 20"`
- One conversation:
  `npx wrangler d1 execute catai-feedback --remote --command "SELECT conversation FROM reports WHERE id = '<id>'"`
- The last 20 error reports:
  `npx wrangler d1 execute catai-feedback --remote --command "SELECT id, created, app, version, substr(error, 1, 200) AS error FROM reports WHERE kind = 'error' ORDER BY created DESC LIMIT 20"`
- One screenshot:
  `npx wrangler r2 object get catai-feedback-shots/screenshots/<id>.png --remote`
