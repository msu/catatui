<h1><img src="assets/bobcat-head.png" alt="Montana State Bobcat" width="90" align="middle"> catatui</h1>

A command line agent harness for MSU students

catatui is the Montana State Command Line Agent.

It is an AI coding agent that runs in your terminal that uses the free (for MSU students & faculty) MSU CatChat AI
models.

catatui is built as an extension on top of the excellent [pi harness](https://pi.dev).

Like all coding agents, catatui can read your code, run commands, and write code for you.

By default catatui runs in `ask` mode and will ask before making any changes. You can also run in `plan`, where it will
write a plan to `PLAN.md` and make no other changes. Turn off `plan` to carry out the plan. You can also run it in `yolo` where it will
not ask permission to make changes.

There is a `ta` option, which works in any mode, that will have the agent teach you and offer hints, rather than writing code for you. We suggest
you use this option frequently.

There is a very simple sandbox mechanism that will prevent the agent from reading or modifying files outside of the directory you
run the harness in. This is a defeatable sandbox by a determined agent.

Finally, the default of the agent is to use [Simplified Technical English](https://www.asd-ste100.org/). This keeps the annoying
chattiness of many AI models down. You may turn this off if you don't like the clipped responses it generates.

All of the above can be configured with the `/mode` command.

## What you need

- An MSU account.
- A connection to the MSU network to make a key. If you are not on campus, connect to the MSU VPN.

## Install

On macOS or Linux, run this in your terminal:

```
curl -fsSL https://catatui.cs.montana.edu/install.sh | sh
```

On Windows, run this in PowerShell:

```
irm https://catatui.cs.montana.edu/install.ps1 | iex
```

The installer puts catatui and its own copy of Node.js in the `~/.catatui/app` folder. It adds the `catatui` command to
your PATH. It does not change the Node.js that you use for other work.

After the install, open a new terminal.

To see your version and check for a newer version, run `catatui --version`.

To update catatui, run `catatui --update`. On Windows, this command shows the install command. Close catatui, then run
the install command.

If you use the fish shell, add `~/.catatui/app/bin` to your PATH yourself.

### Install with npm

If you have Node.js 22 or later and git, you can use npm:

- To run catatui without an install, run `npx github:msu/catatui`.
- To install the `catatui` command, run `npm install -g github:msu/catatui`.

## First use

1. Go to your project folder in the terminal.
2. Run `catatui`.
3. Select "Sign in with your MSU account in a browser", then press Enter. catatui opens catchat access in your browser.
4. Sign in with your MSU account, then click "Create key". catatui gets the key and saves it.
5. Type your question or task, then press Enter.

The key is valid for 180 days. After that, catatui tells you to sign in again.

If the browser sign-in does not work, select "Make a key at catchat access and paste it". catatui shows the steps.

If you close the sign-in with Escape, press Enter to open it again.

catatui selects the model `Qwen3.8-27B`. To pick a different model, type `/model`.

To see the available models, run `catatui --list-models`. To see all command line options, run `catatui --help`.

## Models

These are the CatChat models. Type `/model` to pick one.

| Model               | What it is                                                                            |
|---------------------|---------------------------------------------------------------------------------------|
| `Qwen3.8-27B`       | Alibaba. General and coding model, with thinking. The default and our recommendation. |
| `gpt-oss:120b`      | OpenAI open-weight model, with thinking. Good for coding. The fastest model.          |
| `gemma4-31B-it`     | Google. General model with a long context. Good for coding.                           |
| `muse-glimmer:30b`  | Unknown Model. Very slow.                                                             |
| `nimble:9b`         | Unknown Model.                                                                        |
| `mistral-small:24b` | Mistral. General chat model. Weak at file edits.                                      |
| `llama3.1:8b`       | Meta. Small general model.                                                            |
| `codegemma:7b`      | Google. Code completion model. Not for agent work.                                    |
| `medgemma:4b`       | Google. Medical model for text and images. Not for coding.                            |
| `Goedel-Prover-V2`  | Theorem prover (Lean). Not for general coding.                                        |

CatChat can add or remove models. To see the current list, run `catatui --list-models`.

## Commands

| Command           | Use                                                                                              |
|-------------------|--------------------------------------------------------------------------------------------------|
| `/mode`           | Pick the mode. Turn teaching assistant, the sandbox, and Simplified Technical English on or off. |
| `/undo`           | Put back the files that the agent changed for your last request                                  |
| `/model`          | Pick a CatChat model                                                                             |
| `/context`        | Show what uses the context window of the model                                                   |
| `/catchat`        | Show your sign-in status and get the model list again                                            |
| `/catchat login`  | Sign in to CatChat and get a new key                                                             |
| `/catchat logout` | Sign out of CatChat and stop catatui                                                             |
| `/hotkeys`        | Show the keyboard keys                                                                           |

To stop the agent while it works, press Escape.

## Modes

The mode controls what the agent can do. The bottom line of the screen shows the mode.

To change the mode or an option, type `/mode`. Use the up and down arrows to move. Press Space or Enter to change the
line. Press Escape to close.

| Mode   | What the agent does                                                                                |
|--------|----------------------------------------------------------------------------------------------------|
| `ask`  | The agent will ask before each file change, command and http request. catatui starts in this mode. |
| `plan` | Planning mode. The model will write a plan file (`PLAN.md`) for work but make no changes.          |
| `yolo` | The agent will make changes without asking you to approve them. Use this mode with care.           |

| Option    | What it does                                                                                  | Start value |
|-----------|-----------------------------------------------------------------------------------------------|-------------|
| `ta`      | Teaching assistant. The agent explains concepts and gives hints. It does not write your code. | off         |
| `sandbox` | The agent can use only the files in the project folder.                                       | on          |
| `ste`     | Simplified Technical English. The agent writes short, clear sentences.                        | on          |

`ta` works in all modes. When `ta` is on, the agent cannot change files, also in `yolo` mode.

In `ask` mode, you can select "do not ask again" for some actions. This choice lasts until catatui stops.

Some commands always ask, for example `rm`, `sudo`, `git push`, `npx`, and commands with `&&`, `;`, or `|`.

## Sandbox

The agent can use only the files in the folder where you start catatui. This is the sandbox.

To let the agent use other folders, do one of these steps:

- Type `/mode`, then turn off `sandbox`.
- Start catatui with `catatui --no-sandbox`.

The sandbox is not complete protection. A command can get around it. Read each command before you allow it.

## Simplified Technical English

The agent writes in Simplified Technical English. It uses short sentences and simple words. This makes the answers
easier to read, also for non-native English speakers.

To turn it off, type `/mode`, then turn off `ste`. catatui keeps this choice for the next start.

## Undo

If you do not like the agent's changes, type `/undo`. catatui shows the files that it will put back, then asks you to
confirm.

Each `/undo` goes back one request.

`/undo` has these limits:

- It does not undo changes from commands, for example `npm install` or `rm`.
- It works only until catatui stops.

Use git to keep your work safe.

## Problems

| Problem                             | Cause                                       | Fix                                                                              |
|-------------------------------------|---------------------------------------------|----------------------------------------------------------------------------------|
| The CatChat key page does not load. | The key page works only on the MSU network. | Connect to the MSU VPN, then try again.                                          |
| catatui cannot connect to CatChat.  | A network problem, or CatChat is down.      | Check your network connection. If the problem continues, connect to the MSU VPN. |
| The agent gives a bad answer.       | Some models are weaker.                     | Type `/model` and pick `Qwen3.8-27B`.                                            |
| You want to sign in again.          | Your key is old or wrong.                   | Type `/catchat login`.                                                           |

catatui keeps its settings and sessions in the `~/.catatui` folder.
