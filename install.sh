#!/bin/sh
# CataTUI installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/msu/catatui/master/install.sh | sh
#
# To update CataTUI, run the same command again.
#
# The installer puts all files in ~/.catatui/app:
#   node/  a private copy of Node.js. CataTUI does not use or change the Node.js on your PATH.
#   npm/   the catatui package
#   bin/   the catatui command
# It adds ~/.catatui/app/bin to the PATH in your shell profile.
# It does not need git, sudo, or an installed Node.js.

set -eu

NODE_LINE="latest-v24.x" # Node.js LTS line
PACKAGE="https://codeload.github.com/msu/catatui/tar.gz/refs/heads/master"
APP="${CATATUI_APP:-$HOME/.catatui/app}"

say() { printf '%s\n' "$*"; }
fail() { say "Install failed: $*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this script works only on macOS and Linux. On Windows, use install.ps1." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "CataTUI does not support the CPU type $(uname -m)." ;;
esac
command -v curl >/dev/null || fail "curl is not installed. Install curl, then run this script again."

if command -v sha256sum >/dev/null; then sha() { sha256sum "$1" | cut -d' ' -f1; }
else sha() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# 1. Node.js. Download it only if the version changed.
say "Looking for the newest Node.js ($NODE_LINE)..."
dist="https://nodejs.org/dist/$NODE_LINE"
curl -fsSL "$dist/SHASUMS256.txt" -o "$tmp/sums" || fail "cannot get the Node.js file list. Check your network connection."
file="$(grep " node-v.*-$os-$arch.tar.gz\$" "$tmp/sums" | awk '{print $2}')"
want="$(grep " $file\$" "$tmp/sums" | awk '{print $1}')"
[ -n "$file" ] || fail "no Node.js download for $os-$arch."
version="${file#node-}"
version="${version%%-*}"

if [ -x "$APP/node/bin/node" ] && [ "$("$APP/node/bin/node" --version)" = "$version" ]; then
  say "Node.js $version is already installed."
else
  say "Downloading Node.js $version..."
  curl -fsSL "$dist/$file" -o "$tmp/node.tar.gz" || fail "cannot download Node.js. Check your network connection."
  [ "$(sha "$tmp/node.tar.gz")" = "$want" ] || fail "the Node.js download is damaged. Run this script again."
  mkdir -p "$tmp/node"
  tar -xzf "$tmp/node.tar.gz" -C "$tmp/node" --strip-components 1
  mkdir -p "$APP"
  rm -rf "$APP/node"
  mv "$tmp/node" "$APP/node"
fi

# 2. The catatui package. npm needs node on the PATH.
say "Installing CataTUI..."
PATH="$APP/node/bin:$PATH" npm install --global --prefix "$APP/npm" --no-fund --no-audit --loglevel=error "$PACKAGE" \
  || fail "npm cannot install CataTUI. Read the npm error above, then run this script again."

# 3. The catatui command. It always uses the private Node.js.
mkdir -p "$APP/bin"
cat >"$APP/bin/catatui" <<EOF
#!/bin/sh
exec "$APP/node/bin/node" "$APP/npm/lib/node_modules/catatui/bin/catatui.js" "\$@"
EOF
chmod +x "$APP/bin/catatui"

# 4. The PATH. Add one line to the shell profile, one time only.
line="export PATH=\"$APP/bin:\$PATH\""
case "${SHELL:-}" in
  */zsh) profiles="$HOME/.zshrc" ;;
  */bash) if [ "$os" = darwin ]; then profiles="$HOME/.bash_profile"; else profiles="$HOME/.bashrc"; fi ;;
  *) profiles="$HOME/.profile" ;;
esac
for p in $profiles; do
  if ! grep -qsF "$APP/bin" "$p"; then
    printf '\n# CataTUI\n%s\n' "$line" >>"$p"
    say "Added CataTUI to the PATH in $p."
  fi
done

say ""
say "CataTUI $("$APP/bin/catatui" --version | awk '{print $2}') is installed."
# This script runs in a child process, so it cannot change the PATH of the student's terminal.
case ":$PATH:" in
  *":$APP/bin:"*) ;;
  *) say "To use catatui in this terminal, run: source $(printf '%s' "$profiles" | sed "s|^$HOME|~|")" ;;
esac
say "To start, go to your project folder and run: catatui"
