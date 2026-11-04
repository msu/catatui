# catai installer (internal)

A hidden installer for internal tests of the desktop app (catai) on Windows. The site does not link to it.

    irm https://catatui.cs.montana.edu/catai/install.ps1 | iex

The script is `docs/catai/install.ps1`. GitHub Pages publishes it.

## Steps

1. Run the catatui installer (`docs/install.ps1`): the private Node.js, the catatui package, and git from dugite.
2. Download the repository tarball (master) and keep only `desktop/`, in `~\.catatui\app\catai`.
3. `npm install` (Electron, Vite) and `npm run build` on the student's computer.
4. Write `root.json` with the installed catatui package. main.js loads `bin/catatui.js`, `src/catatui`, and `node_modules` (pi, jiti, dugite) from there, so the app and the `catatui` command use the same files.
5. Add a Start menu item `catai` that starts `electron.exe` with the catai folder, with `build/icon.ico`.

## Decisions

- Build on the target computer, not on a Mac. Reasons: dugite and Electron download the files for the system where npm runs, and there is no code signing yet.
- No electron-builder package yet. That is the later, public installer (one file, signed).

## Subtleties

- The script needs downloads from catatui.cs.montana.edu, nodejs.org, codeload.github.com, and github.com (Electron and dugite releases).
- The app user data (window places, titles) is in Electron's userData folder (`%APPDATA%\catai`), so an update keeps it.
- Close catai before an update. Windows locks the files of a running app.
- Not tested on Windows yet. PowerShell was not available to check the script syntax.
