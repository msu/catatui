#!/usr/bin/env bash
# Publish a release: copy the files on scripts/release-files.txt, from HEAD of this (private) repository,
# to master of the public repository (msu/catatui), as one commit with a version tag.
#
#   scripts/release.sh          Make the release commit in a temporary clone, and show the changes. No push.
#   scripts/release.sh --push   Make the commit, then push master and the tag.
#
# PUBLIC_REPO sets the public repository (default https://github.com/msu/catatui.git).
# Only committed files go out (git archive HEAD). Changes that are not committed are not in the release.
set -euo pipefail

PUSH=0
[ "${1:-}" = "--push" ] && PUSH=1
if [ $# -gt 0 ] && [ "$PUSH" = 0 ]; then
  echo "Usage: scripts/release.sh [--push]" >&2
  exit 2
fi

DEV="$(git rev-parse --show-toplevel)"
cd "$DEV"
PUBLIC_REPO="${PUBLIC_REPO:-https://github.com/msu/catatui.git}"
LIST="$DEV/scripts/release-files.txt"
VERSION="$(node -p 'require("./package.json").version')"
TAG="v$VERSION"

if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: this repository has changes that are not committed. They are not in the release." >&2
fi

# The pathspecs: skip comments and empty lines. "!path" becomes ":(exclude)path".
PATHS=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  line="$(echo "$line" | xargs)"
  [ -z "$line" ] && continue
  if [ "${line:0:1}" = "!" ]; then PATHS+=(":(exclude)${line:1}"); else PATHS+=("$line"); fi
done < "$LIST"

WORK="$(mktemp -d)"
trap 'if [ "$PUSH" = 1 ]; then rm -rf "$WORK"; fi' EXIT

echo "Cloning $PUBLIC_REPO ..."
git clone --quiet --depth 1 --branch master "$PUBLIC_REPO" "$WORK/public"
cd "$WORK/public"

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Release failed: the public repository already has the tag $TAG. Increase the version in package.json, commit, and try again." >&2
  exit 1
fi

# Replace the whole tree, so a file that is no longer on the list goes away in the public repository.
git rm -r --quiet --ignore-unmatch .
git -C "$DEV" archive --format=tar HEAD -- "${PATHS[@]}" | tar -x -C "$WORK/public"
git add -A

if git diff --cached --quiet; then
  echo "Nothing to release: the public master already has these files."
  exit 0
fi

echo
git diff --cached --stat | tail -25
echo
git commit --quiet -m "Release $VERSION" -m "From $(git -C "$DEV" rev-parse --short HEAD) of the private repository."
git tag "$TAG"

if [ "$PUSH" = 1 ]; then
  git push --quiet origin master "refs/tags/$TAG"
  echo "Pushed $TAG to $PUBLIC_REPO."
else
  echo "Release $VERSION is ready in $WORK/public, but it is not pushed."
  echo "Look at the files there. To push, run: scripts/release.sh --push"
fi
