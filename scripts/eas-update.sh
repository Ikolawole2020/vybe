#!/usr/bin/env bash
#
# Publishes an over-the-air JS update to EAS.
#
#   npm run update            # android → preview, message from HEAD
#   npm run update -- ios     # a different platform
#   BRANCH=production npm run update
#
# An update ships the JS bundle only. It reaches devices that are already
# running a native build on the same channel *and* the same runtime version —
# it does not install anything, and it cannot carry a native change. If you
# added a dependency with native code, or changed anything under `android/` or
# `ios/`, this is the wrong tool and you want a new build:
#
#   eas build -p android --profile preview
#
# Three things this handles that a bare `eas update` does not:
#
#   1. `--environment`. eas-cli 22 refuses to run `--non-interactive` without
#      it, with an error that does not mention which value it wants.
#   2. The message. Tagging the update with the commit subject and short SHA is
#      what makes the dashboard readable a week later.
#   3. The dirty-tree trap, which is the real reason this file exists — see
#      below.
set -euo pipefail

cd "$(dirname "$0")/.."

PLATFORM="${1:-android}"
BRANCH="${BRANCH:-preview}"

# EAS resolves `--environment` against the profiles in eas.json. The branch
# names here happen to match those profile names, so one follows the other
# unless it is set explicitly.
ENVIRONMENT="${ENVIRONMENT:-$BRANCH}"

# ------------------------------------------------------------ dirty tree --

# `eas update` bundles the working directory, but stamps the update with
# whatever commit HEAD points at. Those are the same thing only when the tree
# is clean. Publish with uncommitted edits and the dashboard will attribute
# code to a commit that does not contain it, which is a genuinely difficult
# thing to debug later — you read the commit, and the code you are looking for
# is not in it.
if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. An update publishes what is on disk but is" >&2
  echo "tagged with HEAD, so the two would disagree. Commit or stash first:" >&2
  echo >&2
  git status --short >&2
  echo >&2
  echo "To publish anyway:  ALLOW_DIRTY=1 npm run update" >&2
  [ -n "${ALLOW_DIRTY:-}" ] || exit 1
  echo "ALLOW_DIRTY set — continuing with a tree that does not match HEAD." >&2
fi

# ------------------------------------------------------------------ send --

SHA="$(git rev-parse --short HEAD)"
MESSAGE="${MESSAGE:-$(git log -1 --pretty=%s) ($SHA)}"

# The runtime version comes from `version` in app.json, via the appVersion
# policy. Devices only accept an update whose runtime matches their build, so
# bumping that version strands every install until a new build goes out.
RUNTIME="$(node -p "require('./app.json').expo.version")"

echo "Branch:   $BRANCH  (environment: $ENVIRONMENT)"
echo "Platform: $PLATFORM"
echo "Runtime:  $RUNTIME   ← only reaches builds at this version"
echo "Message:  $MESSAGE"
echo

npx eas-cli@latest update \
  --platform "$PLATFORM" \
  --branch "$BRANCH" \
  --environment "$ENVIRONMENT" \
  --message "$MESSAGE" \
  --non-interactive
