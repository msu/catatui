# Feature: HTTP Tool

The agent can send HTTP requests, for example to read docs or to test a local server. The code is in `src/ts/http.ts`.

## Behavior

- The body is cut at 50,000 characters. The timeout is 30 seconds.
- The permission rules in [modes.md](modes.md) apply.

## Decisions

- catatui changes HTML to plain text, so a web page does not fill the context with markup.
- catatui blocks link-local addresses (169.254.x.x and fe80::) in all modes, because these addresses include cloud metadata services.
