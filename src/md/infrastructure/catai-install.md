# catai installer (internal)

Hidden command-line installers for internal tests of the desktop app (catai). The site does not link to them.

    irm https://catatui.cs.montana.edu/catai/install.ps1 | iex           # Windows
    curl -fsSL https://catatui.cs.montana.edu/catai/install.sh | sh     # macOS

The scripts are `docs/catai/install.ps1` and `docs/catai/install.sh`. GitHub Pages publishes them.

## Steps

1. Run the catatui installer (`docs/install.ps1` or `docs/install.sh`) with `CATATUI_PACKAGE` set to the pinned commit: the private Node.js, the catatui package, and git from dugite.
2. Download the repository tarball of the pinned commit and keep only `desktop/`, in `~/.catatui/app/catai`.
3. `npm install` (Electron, Vite) and `npm run build` on the student's computer.
4. Write `root.json` with the installed catatui package. main.js loads `bin/catatui.js`, `src/catatui`, and `node_modules` (pi, jiti, dugite) from there, so the app and the `catatui` command use the same files.
5. Windows: add a Start menu item `catai` that starts `electron.exe` with the catai folder, with `build/icon.ico`.
   macOS: add the command `~/.catatui/app/bin/catai [folder]`. It starts Electron in the background, with its output in `~/.catatui/app/catai.log`.

## Decisions

- Build on the target computer, not on a Mac. Reasons: dugite and Electron download the files for the system where npm runs, and there is no code signing yet.
- Pin one commit (`$Commit`, `COMMIT`) for catatui and catai, so a push to master does not change the installs. To release, change the commit in both scripts.
- No code signing. Downloads by `Invoke-WebRequest` and `curl` do not get the internet download mark, so SmartScreen and Gatekeeper do not check the app. The Electron.app from the Electron release has an ad hoc signature.
- No electron-builder package yet. That is the later, public installer (one file, signed).

## Subtleties

- The script needs downloads from catatui.cs.montana.edu, nodejs.org, codeload.github.com, and github.com (Electron and dugite releases).
- The app user data (window places, titles) is in Electron's userData folder (`%APPDATA%\catai`), so an update keeps it.
- Windows locks the files of a running app. So the script first stops all programs from `~\.catatui\app` (catai, catatui, git), and then tries 5 times to remove the old catai folder. On 2026-11-06 a student install had no `jiti` in the catatui package, and catai did not start. The probable cause is a running catai during the update (not confirmed).
- main.js looks for jiti in 3 folders (in catatui, in pi, next to catatui), because npm can put it in each of them.
- Windows: first used by students on 2026-11-06. The fixes above are not tested on Windows yet. PowerShell was not available to check the script syntax.
- macOS: unpack Electron with `ditto`, which keeps the links in Electron.app. Quit catai before an update.
- macOS: tested end to end with an isolated HOME and a local site (CATATUI_SITE).
