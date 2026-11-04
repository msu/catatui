# Feature: git tools and GitHub sign-in

The agent has git tools that work with no git installed. The code is in `src/catatui/git.ts` (the safe git runner), `src/catatui/gittools.ts` (the tools and `/github`), and `src/catatui/github.ts` (the token).

## Behavior

- Tools:
  - Read, no question: `git_status`, `git_diff`, `git_log`.
  - Change: `git_init`, `git_commit` (add, then commit), `git_restore` (put files back to the last commit).
  - Remote: `git_clone`, `git_pull`, `git_push`. `git_push` with `url` adds the remote `origin` if there is none.
- Permissions (permissions.ts):
  - `git_commit` and `git_init` ask like a file change. The student can allow commits for the session.
  - `git_restore` always asks, because it loses changes.
  - The remote tools always ask, also in yolo mode.
  - ta and plan mode block the change tools, `git_clone`, and `git_pull`. `git_push` only asks.
- The repository must start in the project folder (sandbox on). `git_init` makes a new repository in the project if the repository around it starts outside, for example in the home folder.
- If git has no user name or email, a commit uses the GitHub login with `<login>@users.noreply.github.com`, or the computer user name with `@localhost`.
- `run` blocks the `git` program. The model uses the git tools.

## GitHub sign-in

- The student makes a classic personal access token with the `repo` scope. `TOKEN_URL` opens the GitHub form with the scope and the name filled in.
- CLI: `/github login` asks for the token. `/github` shows the status. `/github logout` removes it.
- Desktop app: the account menu has "Sign in to GitHub...", the login, the expiry, and "Sign out of GitHub".
- catatui sends `GET /user` to check the token, then saves `{ token, login, expires }` in `~/.catatui/github.json` with mode 600.
- The model and the renderer never get the token. git gets it from a credential helper that reads it from the environment of that one git process.

## Decisions

- git comes from the dugite npm package (git 2.53 at dugite 3.2.3), not from an installed git. Reason: many Windows students do not have Git for Windows. dugite was picked over isomorphic-git because it is real git, with full behavior. (isomorphic-git has no SSH and limited merges.)
- Only the catai token. catatui does not use SSH keys, `git credential fill`, `gh auth token`, or the student's keychain. Reasons:
  - An SSH key opens more than GitHub (lab servers, other hosts).
  - The student gives clear consent, and can revoke the catai token alone on GitHub.
- No OAuth app. MSU does not need to register and own a GitHub app. A device flow is a possible later upgrade.
- SSH remotes: git changes `git@github.com:` and `ssh://git@github.com/` to `https://github.com/` for each command (`url.<base>.insteadOf`). The repository config does not change, so the student's own git still uses SSH. Other SSH hosts are not supported in catatui (`protocol.ssh.allow=never`).

## Safety (git.ts)

A project can come from anywhere, for example a zip file with a `.git` folder. git can start other programs. So:

- Each command turns off hooks (`core.hooksPath` to an empty folder), `core.fsmonitor`, the pager, `core.askPass`, `diff.external`, signing, SSH, and the `ext` protocol. It removes all credential helpers, then adds only the catai helper for `https://github.com`.
- `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`: git never waits for a password. stdin is always closed.
- `repoRisk` reads `.git/config` (`git config --local`, without include files). If it has a key that can start a program or read another file (for example `core.sshCommand`, `filter.*.clean`, `diff.*.textconv`, `include.path`, `credential.*`), catatui refuses all git commands in that repository and names the keys. The desktop app then shows no git status.

## Subtleties

- dugite downloads git in its `postinstall` script, from the `desktop/dugite-native` GitHub releases, with a checksum. The install scripts run npm with scripts on, so this works. If the download fails, the git tools fail. See [../infrastructure/distribution.md](../infrastructure/distribution.md).
- The Windows dugite git has `sh.exe` (the credential helper needs it), `ssh.exe`, and Git Credential Manager, but no `bash.exe`. catatui does not use its `ssh.exe` or Git Credential Manager.
- `github-authentication-token-expiration` is the GitHub header for the token expiry. If GitHub does not send it, catatui shows no expiry. Not verified for all token types.
- If the class organizations use SAML single sign-on, the student must also authorize the token for the organization on GitHub.
- The git tools do not go into `/undo`. git is the undo for them.
