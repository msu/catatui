# CataTUI

CataTUI is the Montana State Command Line Agent. It is a terminal coding agent for MSU students. It uses the MSU CatChat AI models. It is built on [pi](https://pi.dev).

## Install

You need Node.js 22 or later. Get it at https://nodejs.org.

Run CataTUI without an install:

```
npx github:msu/catatui
```

The first run downloads CataTUI and its packages. This can take a minute.

Or install the `catatui` command:

```
npm install -g github:msu/catatui
```

To update, run the same install command again.

## First use

1. If you are not on campus, connect to the MSU VPN.
2. In your project folder, run `npx github:msu/catatui` or `catatui`.
3. Press Enter to run `/login catchat`. catatui types it for you.
4. Sign in with your MSU account, or paste a key from catchat-access.
5. Type `/model` to pick a model. The default is `gpt-oss:120b`.

## Commands

| Command | Use |
|---|---|
| `/login catchat` | Sign in to CatChat |
| `/model` | Pick a CatChat model |
| `/catchat` | Show sign-in status and reload the model list |
| `/catchat reset` | Sign out of CatChat and exit |
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
| `extensions/msu/banner.ts` | Header: bobcat head and commands |
| `themes/msu.json` | MSU blue and gold theme |
