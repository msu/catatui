# Distribution

catatui is on GitHub (`msu/catatui`). It is not on the npm registry.

## Install Scripts

- The scripts install a private Node.js 24 LTS in `~/.catatui/app/node`, so the student does not need Node.js. The scripts do not change the student's own Node.js.
- The scripts check the Node.js download against the SHA-256 checksum from nodejs.org.
- The scripts install catatui from the GitHub tarball URL, not with `github:msu/catatui`, because npm needs git for `github:` installs.
- The scripts add `~/.catatui/app/bin` to the PATH.
- The `catatui` command sets `CATATUI_APP`, so `catatui --update` knows that a script installed catatui.

## Updates

- `catatui --version` compares the local version with `package.json` on GitHub. If you do not increase the version, students do not see the update.
- `catatui --update` runs the install script again on macOS and Linux.
- There is no automatic update.

## Subtleties

- A piped script cannot change the PATH of the open terminal on macOS and Linux. So `install.sh` shows a `source` command.
- On Windows, `install.ps1` uses `npm.cmd`, because the default execution policy blocks `npm.ps1`.
- On Windows, `catatui --update` shows the install command only, because the script cannot replace `node.exe` while catatui runs.
- raw.githubusercontent.com keeps a file in its cache for up to 5 minutes, so students can see a new version up to 5 minutes after a push.
- The check does not use the GitHub API. Without a login, the API allows 60 requests per hour from one IP address, and students on the campus network can share one IP address.
