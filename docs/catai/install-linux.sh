#!/bin/sh
# catai installer for Linux (internal test build). Run it in a terminal:
#
#   curl -fsSL https://catatui.cs.montana.edu/catai/install-linux.sh | sh
#
# To update catai, run the same command again. Quit catai first.
#
# The installer:
#   1. installs catatui with the catatui installer (Node.js, the catatui package, and git from dugite);
#   2. gets the catai app (the desktop folder of the repository) into ~/.catatui/app/catai;
#   3. installs its packages (Electron and Vite) and builds it on this computer;
#   4. adds the "catai" command next to the "catatui" command, and a "catai" item in the application menu.
# It does not need git, sudo, or an installed Node.js. It needs curl and unzip.
# To remove catai: delete ~/.catatui/app/catai, ~/.catatui/app/bin/catai and
# ~/.local/share/applications/catai.desktop.

set -eu

# The commit to install. Keep it the same as in install.sh and install.ps1.
COMMIT="f645b1f9712ca24785e09bf1370e214abe36189e"
REPO="https://codeload.github.com/msu/catatui/tar.gz/$COMMIT"
SITE="${CATATUI_SITE:-https://catatui.cs.montana.edu}"
APP="${CATATUI_APP:-$HOME/.catatui/app}"
CATAI="$APP/catai"

say() { printf '%s\n' "$*"; }
fail() { say "Install failed: $*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || fail "this script works only on Linux. On macOS, use install.sh. On Windows, use install.ps1."
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "catai does not support the CPU type $(uname -m)." ;;
esac
command -v curl >/dev/null || fail "curl is not installed. Install curl (for example: sudo apt install curl), then run this script again."
command -v unzip >/dev/null || fail "unzip is not installed. Install unzip (for example: sudo apt install unzip), then run this script again."
if command -v sha256sum >/dev/null; then sha() { sha256sum "$1" | cut -d' ' -f1; }
else sha() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi

# 1. catatui. catai starts catatui for each project, and uses its files (root.json below).
say "Installing catatui (catai uses it)..."
curl -fsSL "$SITE/install.sh" -o "${TMPDIR:-/tmp}/catatui-install.$$.sh" \
  || fail "cannot get the catatui installer from $SITE. Check your network connection."
CATATUI_PACKAGE="$REPO" CATATUI_APP="$APP" sh "${TMPDIR:-/tmp}/catatui-install.$$.sh" \
  || { rm -f "${TMPDIR:-/tmp}/catatui-install.$$.sh"; fail "the catatui install failed. Read the error above."; }
rm -f "${TMPDIR:-/tmp}/catatui-install.$$.sh"
node="$APP/node/bin"
pkg="$APP/npm/lib/node_modules/catatui"
[ -f "$pkg/bin/catatui.js" ] || fail "catatui is not in $pkg after the install."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 2. The app files: the desktop folder of the repository.
say ""
say "Downloading catai..."
curl -fsSL "$REPO" -o "$tmp/catatui.tgz" || fail "cannot download catai from GitHub. Check your network connection."
mkdir "$tmp/src"
tar -xzf "$tmp/catatui.tgz" -C "$tmp/src" --strip-components 1 || fail "cannot unpack the catai download."
[ -f "$tmp/src/desktop/main.js" ] || fail "the catai download has no desktop folder."
rm -rf "$CATAI" || fail "cannot replace the old catai files. Quit catai, then run this script again."
mkdir -p "$APP"
mv "$tmp/src/desktop" "$CATAI"

# 3. The packages and the build. npm and Vite need node on the PATH. Electron (about 100 MB) comes from GitHub.
cd "$CATAI"
say "Installing the catai packages (Electron). This can take some minutes..."
PATH="$node:$PATH" npm install --cache "$APP/npm-cache" --no-fund --no-audit --loglevel=error \
  || fail "npm cannot install the catai packages. Read the npm error above, then run this script again."
# Electron 44 has no postinstall script: it downloads its program on first use. So download and unpack Electron
# here, with the checksum from the Electron package. This makes the same files as the Electron install.js: dist/ and path.txt.
epkg="$CATAI/node_modules/electron"
ever="$(PATH="$node:$PATH" node -p 'require("./node_modules/electron/package.json").version')"
ename="electron-v$ever-linux-$arch.zip"
esum="$(PATH="$node:$PATH" node -p "require('./node_modules/electron/checksums.json')['$ename'] || ''")"
[ -n "$esum" ] || fail "the Electron package has no checksum for $ename."
say "Downloading Electron $ever ($arch)..."
curl -fsSL "https://github.com/electron/electron/releases/download/v$ever/$ename" -o "$tmp/$ename" \
  || fail "cannot download Electron. Check that this computer can download from github.com, then run this script again."
[ "$(sha "$tmp/$ename")" = "$esum" ] || fail "the Electron download is damaged. Run this script again."
rm -rf "$epkg/dist"
unzip -q "$tmp/$ename" -d "$epkg/dist" || fail "cannot unpack Electron."
# No line end: the Electron package reads path.txt as it is.
printf '%s' "electron" >"$epkg/path.txt"
say "Building catai..."
PATH="$node:$PATH" npm run build --silent || fail "the catai build failed. Read the error above."

# root.json: catai uses the installed catatui package (bin, src, node_modules), so both have the same version.
printf '{ "root": "%s" }\n' "$pkg" >"$CATAI/root.json"

# 4. The catai command. It starts Electron with the catai folder, and gives it the folder to open, if any.
# Electron runs in the background, so the terminal is free. Its output goes to catai.log.
# The Chromium sandbox on Linux needs chrome-sandbox owned by root with the setuid bit, and this script does not use
# sudo. Without that, the command starts Electron with --no-sandbox. The installer prints the sudo command to fix it.
electron="$epkg/dist/electron"
sandbox="$epkg/dist/chrome-sandbox"
[ -x "$electron" ] || fail "Electron is not in $electron. Run this script again."
mkdir -p "$APP/bin"
cat >"$APP/bin/catai" <<EOF
#!/bin/sh
# Start catai. Usage: catai [--demo-mode] [project folder]
# A folder becomes a full path, because Electron does not start in this folder. Options stay as they are.
for a in "\$@"; do
  shift
  case "\$a" in
    -*) set -- "\$@" "\$a" ;;
    *) a="\$(cd "\$a" && pwd)" || exit 1; set -- "\$@" "\$a" ;;
  esac
done
if [ "\$(stat -c '%u %a' "$sandbox" 2>/dev/null)" != "0 4755" ]; then set -- --no-sandbox "\$@"; fi
nohup "$electron" "$CATAI" "\$@" >"$APP/catai.log" 2>&1 &
EOF
chmod +x "$APP/bin/catai"

# The application menu item (freedesktop .desktop file).
apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$apps"
cat >"$apps/catai.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=catai
Comment=catai: your AI agent at Montana State University
Exec=$APP/bin/catai
Icon=$CATAI/build/icon.png
Terminal=false
Categories=Development;
EOF

say ""
say "catai is installed."
say "To start it, run: catai, or open catai in the application menu."
# This script runs in a child process, so it cannot change the PATH of the student's terminal.
case ":$PATH:" in
  *":$APP/bin:"*) ;;
  *) say "If the terminal cannot find catai, open a new terminal, or run: $(printf '%s' "$APP/bin/catai" | sed "s|^$HOME|~|")" ;;
esac
say "To open a project folder, run: catai <folder>"
say "If catai does not start, read $(printf '%s' "$APP/catai.log" | sed "s|^$HOME|~|")."
say "Optional: to turn on the Chromium sandbox, run:"
say "  sudo chown root:root $sandbox && sudo chmod 4755 $sandbox"
