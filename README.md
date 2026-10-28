# catatui

catatui is a terminal coding agent for Montana State University students. It uses the MSU CatChat AI models. It is built on [pi](https://pi.dev).

## Install

You need Node.js 22 or later.

```
npm install -g catatui
```

TODO: publish to npm, or document `npm install -g github:<org>/catatui`.

## First use

1. If you are not on campus, connect to the MSU VPN.
2. Run `catatui` in your project folder.
3. Type `/login`, then select **MSU CatChat**.
4. Sign in with your MSU account, or paste a key from catchat-access.
5. Type `/model` to pick a model.

## Commands

| Command | Use |
|---|---|
| `/login` | Sign in to CatChat |
| `/model` | Pick a CatChat model |
| `/catchat` | Show sign-in status and reload the model list |
| `/hotkeys` | Show keys |

catatui keeps its settings and sessions in `~/.catatui`. Set `PI_CODING_AGENT_DIR` to use a different folder.

## Use with pi

If you already use pi, install only the extension:

```
pi install /path/to/catatui
```

The extension adds the CatChat provider and the MSU header. It does not change your theme or model.

## Developers

| Task | Command |
|---|---|
| Install packages | `npm install` |
| Run | `node bin/catatui.js` |

| File | Content |
|---|---|
| `bin/catatui.js` | Launcher. Runs pi with the extension, the theme, and `~/.catatui`. |
| `extensions/msu/config.ts` | CatChat URLs and defaults |
| `extensions/msu/auth.ts` | `/login`: MSU SSO (PKCE) or a pasted key |
| `extensions/msu/models.ts` | Model list from CatChat |
| `extensions/msu/banner.ts` | Animated bobcat header |
| `themes/msu.json` | MSU blue and gold theme |
