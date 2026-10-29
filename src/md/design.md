# catatui design decisions

This document gives the design decisions for catatui and the reason for each decision.

Each decision has the file that contains it. Paths are relative to the project folder.

## 1. Base: the pi harness

**Decision:** catatui is an extension to the pi coding agent (`@earendil-works/pi-coding-agent`). It is not a new agent.

**Reasons:**

- pi has a terminal UI, tools, sessions, and an extension API.
- pi and its extensions use TypeScript.
- An extension can add a model provider, commands, tools, flags, and event handlers.
- CatVibes is the MSU GUI client. catatui is the terminal client for computer science students.

**Version:** `package.json` sets an exact pi version (1.4.0). catatui uses some pi internals (see section 3). A new pi version can break them, so update pi on purpose and test.

## 2. The catatui command

**Decision:** `bin/catatui.js` starts pi with the catatui extension, themes, and skills.

- It sets `CATATUI=1`. The extension changes pi behavior only when this value is set.
- It sets the pi agent folder to `~/.catatui`. A plain pi install on the same computer keeps its own settings.
- It selects the `msu` theme on a dark terminal and the `msu-light` theme on a light terminal.

**Reason:** a developer can also install the extension in plain pi (`pi install`). Then the extension adds only the CatChat provider, the header, the `http` tool, `/undo`, and the STE skill. It does not change the theme, the model, or the permission behavior.

## 3. Changes to pi internals

pi has no public API for three behaviors. catatui changes pi internals for them. If a pi update removes an internal, catatui falls back to the normal pi behavior. Nothing else breaks.

| Internal | File | Change |
|---|---|---|
| `defaultModelPerProvider` | `src/ts/index.ts` | Add `catchat`. Without it, pi shows "no default model is configured" after `/login`. |
| `InteractiveMode.prototype.showWarning` | `bin/catatui.js` | Hide "No models available" and open `/login catchat` at once. |
| `InteractiveMode.prototype.showError` | `bin/catatui.js` | Hide "This operation was aborted" when the student closes the sign-in with Escape. |

## 4. Sign-in

**Decision:** the student pastes a CatChat API key. The file is `src/ts/auth.ts`.

**Reasons:**

- MSU SSO does not work. Students do not have access to the CatChat app in Azure (error AADSTS50105). CatVibes has the SSO code (`src/main/auth/pkce.ts`), if RCI gives access later.
- The key page (catchat-access) works only on the MSU network or the MSU VPN. The sign-in text says this.

**Details:**

- At the first start, catatui opens the sign-in at once. The student does not type `/login`.
- The browser opens only after the student presses Enter. Then the student can read the steps first.
- The steps tell the student to select the team "gsoc". This team is correct for all students.
- `cleanKey` removes smart quotes, spaces, zero-width characters, `export X_API_KEY=`, and `Bearer`. Text copied from a web page or a PDF often has these.
- catatui sends the key to `/v1/models` before it saves the key. A bad key gives an error at sign-in, not at the first prompt.
- A pasted key has no refresh token. catatui treats it as valid for 180 days, the catchat-access maximum.
- If the student types a prompt before the sign-in, catatui shows "Sign in to CatChat first" and puts `/login catchat` in the editor. pi shows an error with links to the pi docs in this case. This text is not useful for students.
- After the sign-in, catatui removes `/login catchat` from the editor.
- `/catchat reset` removes the key, the model list, and the saved CatChat model, then stops catatui. pi keeps these values in memory, so a restart is necessary.

## 5. Models

The file is `src/ts/config.ts`.

- **Default model:** `Qwen3.8-27B`. It passed all tool-call tests.
- **Start model:** if the student saved a model with `/model`, catatui uses it. If not, catatui uses the first match in `PREFERRED_MODELS`.
- **Hidden models:** CatChat lists some alias names (for example "opus") that are not the real model. catatui hides them. It also hides embedding models, because they cannot chat.
- **Model notes:** `/model` shows a short note for each model. The notes come from a small tool-call test on 2026-10-28. They are a guide only.
- **Limits:** if CatChat does not give a context window, catatui uses 32768 tokens. CatChat reports 983k for Qwen. This value is not confirmed. Ask RCI for the real value.
- **Thinking:** catatui does not change the pi default (`medium`). It is not confirmed that CatChat sends this setting to the model.

## 6. Modes and options

The file is `src/ts/permissions.ts`. The `/mode` command opens a panel. Space or Enter changes a line. The panel stays open until Escape.

**Modes (one of):**

| Mode | Behavior |
|---|---|
| `ask` | The agent asks before each file change, command, and http request. This is the start mode. |
| `plan` | The agent writes `PLAN.md` and changes no other file. It sends only GET requests. |
| `yolo` | The agent asks nothing. |

**Options (on or off):** `ta`, `sandbox`, and `ste`. These are options, not modes, because each one works with all modes.

**Reasons:**

- The modes are like the permission modes in Claude Code.
- `ask` is the start mode, because new users do not know what the agent can do.
- In `ask` mode, the student can select "do not ask again" for file changes, for one command name, or for GET requests to one host.
- Some commands always ask, and "do not ask again" is not available for them:
  - Commands that can run other commands (`npx`, `sh`, `python`, `sudo`, and more). If not, "do not ask again for npx" allows all programs.
  - Commands with `;`, `&`, `|`, a backtick, or `$(`. A chain can hide a second command after an allowed first word.
  - Risky commands: `rm`, `git push`, `git reset`, `chmod`, and `curl | sh`.
- The mode, `ta`, and the "do not ask again" choices last for one session only. The student starts in a safe state each time.

The command name is `/mode`, not `/safety` or `/config`. The panel holds more than safety settings, and pi already uses `/settings`.

## 7. Sandbox

The file is `src/ts/sandbox.ts`.

**Decision:** the agent can use only files in the folder where catatui started. The sandbox is on by default and applies in all modes.

- File tools (`read`, `write`, `edit`, `grep`, `find`, `ls`): catatui blocks a path outside the folder. It uses the real path, so a symbolic link cannot point outside.
- Shell tools (`bash`, `powershell`): catatui blocks a command that contains a path outside the folder (`/x`, `~`, `$HOME`, `..`, `C:\`).
- To turn it off, use `/mode` or `catatui --no-sandbox`.

**Limit:** the shell check reads only the command text. It is not an OS sandbox. A command can get around it. The README tells students this.

**Reason:** an OS sandbox is different on each platform. A text check is simple and stops most mistakes.

## 8. Teaching assistant (ta)

The file is `src/ts/permissions.ts`.

**Decision:** when `ta` is on, the agent explains and gives hints. It does not write the solution.

- catatui adds a teaching-assistant section to the system prompt.
- catatui blocks `edit`, `write`, and http requests other than GET, in all modes. This includes `yolo`.
- The agent can show short general examples, but not the solution to the student's task.
- The agent can read files and run commands, for example tests.

**Reason:** `ta` is a learning aid, not an academic integrity control. The student can turn it off. It is off by default.

## 9. Simplified Technical English (STE)

The files are `src/ts/ste.ts` and `skills/simplified-technical-english/SKILL.md`.

**Decision:** the agent writes in a short form of ASD-STE100. The skill has 8 rules. STE is on by default.

- pi loads a skill only when the model asks for it. So when STE is on, catatui puts the skill text in the system prompt for each request.
- The rules apply to prose only, not to code or quoted output.
- The STE choice stays after catatui stops. It is in `~/.catatui/catatui.json`.

**Reasons:**

- Short, clear answers are easier to read, also for non-native English speakers.
- STE removes much of the extra text that models add.

## 10. Undo

The file is `src/ts/undo.ts`.

**Decision:** `/undo` puts back the files that the agent changed for the last request.

- Before each allowed `edit` or `write`, catatui keeps a copy of the file. It notes a file that did not exist.
- One request is one undo step. catatui keeps 20 steps.
- `/undo` shows the files and asks the student to confirm. It warns if the student changed a file after the agent.
- After an undo, catatui tells the model which files changed, with the next request.
- `/undo` is not available while the agent works.

**Limits:** `/undo` does not undo changes from commands. The copies stay in memory, so they last for one session only. The README tells students to use git.

**Reason:** the undo handler runs after the sandbox and permission handlers. It sees only the calls that they allowed.

## 11. The http tool

The file is `src/ts/http.ts`.

**Decision:** the agent can send HTTP requests, for example to read docs or to test a local server.

- catatui changes HTML to plain text, so a web page does not fill the context with markup.
- The body is cut at 50,000 characters. The timeout is 30 seconds.
- catatui blocks link-local addresses (169.254.x.x and fe80::) in all modes. These addresses include cloud metadata services.
- The permission rules in section 6 apply.

## 12. Screen

**Header** (`src/ts/banner.ts`, `src/ts/logo.ts`):

- Terminals with an image protocol (Kitty, iTerm2) show `assets/bobcat-head.png`.
- Other terminals show a pixel-art bobcat. It uses a checkerboard of half blocks: green on dark terminals, MSU blue and gold on light terminals.
- The pixel art shows color bands in some terminal fonts. This is a font problem. catatui does not fix it.

**Footer** (`src/ts/footer.ts`): one line with short labels: `cwd:`, `model:`, `think:`, `ctx:`, and `mode:`. If the line is too long, catatui cuts the start of the folder path.

**Themes** (`themes/`): `msu` (dark) and `msu-light` (light), in MSU blue and gold.

**Name:** the name is "catatui", all lowercase, in the program and in the README.

## 13. Distribution

**Decision:** catatui is on GitHub (`msu/catatui`). It is not on the npm registry.

**Install scripts** (`install.sh` for macOS and Linux, `install.ps1` for Windows):

- The script installs a private Node.js 24 LTS in `~/.catatui/app/node`. The student does not need Node.js. The script does not change the student's own Node.js.
- The script checks the Node.js download against the SHA-256 checksum from nodejs.org.
- The script installs catatui from the GitHub tarball URL, not with `github:msu/catatui`. npm needs git for `github:` installs, and many students do not have git.
- The script adds `~/.catatui/app/bin` to the PATH. On macOS and Linux, a piped script cannot change the PATH of the open terminal. So the script shows a `source` command.
- On Windows, the script uses `npm.cmd`, because the default execution policy blocks `npm.ps1`.
- The `catatui` command sets `CATATUI_APP`. Then `catatui --update` knows that the install script installed catatui.

**Updates:**

- `catatui --version` compares the local version with `package.json` on GitHub. Increase the version for each release. If not, students do not see the update.
- raw.githubusercontent.com keeps a file in its cache for up to 5 minutes. So students can see a new version up to 5 minutes after a push.
- catatui does not use the GitHub API for this check. Without a login, the API allows 60 requests per hour from one IP address. Students on the campus network can share one IP address.
- `catatui --update` runs the install script again on macOS and Linux. On Windows, it shows the install command, because the script cannot replace `node.exe` while catatui runs.
- `catatui update` also runs the catatui update. Without this, pi runs `pi update`, which does not work for catatui.
- There is no automatic update.

## 14. Open items

- Get permission from MSU to use the bobcat logo.
- Ask RCI about SSO access for students.
- Ask RCI for the real context window of each model.
- Test the install scripts on Linux and Windows.
- Test `ta` and STE with a real model.
