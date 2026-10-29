# CataTUI

CataTUI is the Montana State Command Line Agent. It is an AI coding agent that runs in your terminal. It uses the MSU CatChat AI models. It is built on [pi](https://pi.dev).

The agent can read your code, run commands, and change files. It asks you before it changes a file or runs a command.

> TODO: Add the course rules for AI tools here, or a link to them.

## What you need

- An MSU account.
- A connection to the MSU network to make a key. If you are not on campus, connect to the MSU VPN.

## Install

On macOS or Linux, type this in your terminal:

```
curl -fsSL https://raw.githubusercontent.com/msu/catatui/master/install.sh | sh
```

On Windows, type this in PowerShell:

```
irm https://raw.githubusercontent.com/msu/catatui/master/install.ps1 | iex
```

The installer puts CataTUI and its own copy of Node.js in the `~/.catatui/app` folder. It adds the `catatui` command to your PATH. It does not change the Node.js that you use for other work.

After the install, open a new terminal.

To update CataTUI, type the same install command again.

If you use the fish shell, add `~/.catatui/app/bin` to your PATH yourself.

### Install with npm

If you have Node.js 22 or later and git, you can use npm:

- To run CataTUI without an install, type `npx github:msu/catatui`.
- To install the `catatui` command, type `npm install -g github:msu/catatui`.

## First use

1. Go to your project folder in the terminal.
2. Type `catatui`.
3. CataTUI shows the steps to make an API key. Press Enter. CataTUI opens catchat access in your browser.
4. Click "API Keys", then "+ Free Key". Give the key a unique name, select "gsoc" as your Team, then click "Create Key".
5. Copy the key, paste it into CataTUI, then press Enter.
6. Type your question or task, then press Enter.

If you close the sign-in with Escape, press Enter to open it again.

CataTUI selects the model `Qwen3.8-27B`. To pick a different model, type `/model`.

## Commands

| Command | Use |
|---|---|
| `/mode` | Pick the mode. Turn teaching assistant, the sandbox, and Simplified Technical English on or off. |
| `/undo` | Put back the files that the agent changed for your last request |
| `/model` | Pick a CatChat model |
| `/login catchat` | Sign in to CatChat |
| `/catchat` | Show your sign-in status and get the model list again |
| `/catchat reset` | Sign out of CatChat and stop CataTUI |
| `/hotkeys` | Show the keyboard keys |

To stop the agent while it works, press Escape.

## Modes

The mode controls what the agent can do. The bottom line of the screen shows the mode.

To change the mode or an option, type `/mode`. Use the up and down arrows to move. Press Space or Enter to change the line. Press Escape to close.

| Mode | What the agent does |
|---|---|
| `ask` | The agent will ask before each file change, command and http request. CataTUI starts in this mode. |
| `plan` | Planning mode. The model will write a plan file (`PLAN.md`) for work but make no changes. |
| `yolo` | The agent will make changes without asking you to approve them. Use this mode with care. |

| Option | What it does | Start value |
|---|---|---|
| `ta` | Teaching assistant. The agent explains concepts and gives hints. It does not write your code. | off |
| `sandbox` | The agent can use only the files in the project folder. | on |
| `ste` | Simplified Technical English. The agent writes short, clear sentences. | on |

`ta` works in all modes. When `ta` is on, the agent cannot change files, also in `yolo` mode.

In `ask` mode, you can select "do not ask again" for some actions. This choice lasts until CataTUI stops.

Some commands always ask, for example `rm`, `sudo`, `git push`, `npx`, and commands with `&&`, `;`, or `|`.

## Sandbox

The agent can use only the files in the folder where you start CataTUI. This is the sandbox.

To let the agent use other folders, do one of these steps:

- Type `/mode`, then turn off `sandbox`.
- Start CataTUI with `catatui --no-sandbox`.

The sandbox is not complete protection. A command can get around it. Read each command before you allow it.

## Simplified Technical English

The agent writes in Simplified Technical English. It uses short sentences and simple words. This makes the answers easier to read, also for non-native English speakers.

To turn it off, type `/mode`, then turn off `ste`. CataTUI keeps this choice for the next start.

## Undo

If you do not like the agent's changes, type `/undo`. CataTUI shows the files that it will put back, then asks you to confirm.

Each `/undo` goes back one request.

`/undo` has these limits:

- It does not undo changes from commands, for example `npm install` or `rm`.
- It works only until CataTUI stops.

Use git to keep your work safe.

## Problems

| Problem | Cause | Fix |
|---|---|---|
| The CatChat key page does not load. | The key page works only on the MSU network. | Connect to the MSU VPN, then try again. |
| CataTUI cannot connect to CatChat. | A network problem, or CatChat is down. | Check your network connection. If the problem continues, connect to the MSU VPN. |
| The agent gives a bad answer. | Some models are weaker. | Type `/model` and pick `Qwen3.8-27B`. |
| You want to sign in again. | Your key is old or wrong. | Type `/catchat reset`, then start CataTUI again. |

> TODO: Add a contact for help.

CataTUI keeps its settings and sessions in the `~/.catatui` folder.

## For developers

To use only the extension in pi, type `pi install /path/to/catatui`. The extension adds the CatChat provider, the MSU header, the `http` tool, `/undo`, and the `simplified-technical-english` skill. It does not change your theme or model.

| Task | Command |
|---|---|
| Install packages | `npm install` |
| Run | `node bin/catatui.js` |

| File | Content |
|---|---|
| `install.sh`, `install.ps1` | Installers for macOS and Linux, and for Windows |
| `bin/catatui.js` | Launcher. Runs pi with the extension, the themes, the skills, and `~/.catatui`. |
| `extensions/msu/config.ts` | CatChat URLs, the default model, and model notes |
| `extensions/msu/auth.ts` | `/login` with a pasted key from catchat-access |
| `extensions/msu/models.ts` | Model list from CatChat |
| `extensions/msu/banner.ts`, `logo.ts` | Header: bobcat logo and commands |
| `extensions/msu/footer.ts` | Bottom status line |
| `extensions/msu/permissions.ts` | `/mode` panel, modes, and `ta` |
| `extensions/msu/sandbox.ts` | Sandbox |
| `extensions/msu/ste.ts` | Puts the STE skill in the system prompt |
| `extensions/msu/undo.ts` | `/undo` |
| `extensions/msu/http.ts` | `http` tool |
| `skills/simplified-technical-english/SKILL.md` | The 8 STE rules |
| `themes/` | MSU blue and gold themes, dark and light |
