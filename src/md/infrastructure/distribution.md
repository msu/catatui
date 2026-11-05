# Distribution

catatui is on GitHub (`msu/catatui`). It is not on the npm registry. The install scripts are on https://catatui.cs.montana.edu.

## Install Scripts

- The scripts install a private Node.js 24 LTS in `~/.catatui/app/node`, so the student does not need Node.js. The scripts do not change the student's own Node.js.
- The scripts check the Node.js download against the SHA-256 checksum from nodejs.org.
- The scripts install catatui from the GitHub tarball URL, not with `github:msu/catatui`, because npm needs git for `github:` installs.
- The scripts add `~/.catatui/app/bin` to the PATH.
- npm runs the `postinstall` script of the `dugite` package. It downloads git for the current system (about 47 MB on Windows) from the `desktop/dugite-native` GitHub releases, and checks the checksum. If a network blocks GitHub downloads, this step fails. See [../features/git.md](../features/git.md).
- The `catatui` command sets `CATATUI_APP`, so `catatui --update` knows that a script installed catatui.

## Script Locations

- The install scripts are `docs/install.sh` and `docs/install.ps1`. GitHub Pages publishes them on the catatui site.
- `install.sh` and `install.ps1` in the project root are small forwarders to the site. Do not remove them, because installed copies of catatui 0.5.2 and older use these GitHub URLs.
- The scripts and the version check still get the package and `package.json` from GitHub.

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

## Release to the public repository

The development repository is private. The public repository `msu/catatui` has GitHub Pages, the issues, and the release files. The install URLs (codeload tarball, raw `package.json`) use the public repository.

- `scripts/release-files.txt` lists the files that go public. A path that is not on the list stays private.
- `scripts/release.sh` copies these files from `HEAD` (only committed files) into a temporary clone of the public master. It makes one commit, "Release <version>", and the tag `v<version>`. Without `--push`, it shows the changes and does not push.
- The script replaces the whole public tree, so a file removed from the list goes away in the public repository.
- The script stops if the public repository already has the tag. Increase the version in `package.json` first.
- `docs/catai` and `desktop/` are not on the list. The hidden catai installer downloads `desktop/` from the public tarball, so it does not work while `desktop/` is private.
