#!/usr/bin/env bash
#
# Builds a release APK and drops it in the project root as `vybe.apk`.
#
#   npm run build:apk
#
# Two things this handles that a bare `./gradlew assembleRelease` does not:
#
#   1. The JDK. Gradle for React Native 0.86 does not support Java 26, which is
#      what `java -version` reports on this machine. Android Studio ships a
#      supported JDK inside itself; this finds it rather than making you install
#      a second one.
#   2. `/android` is generated and gitignored, so a fresh clone has no project
#      to build until `expo prebuild` has run.
#
# The APK is signed with the **debug** keystore unless signing is configured in
# `android/app/build.gradle` — installable on any device, not shippable to Play.
# For that, use EAS:  eas build -p android --profile production
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------- JDK --

if [ -z "${JAVA_HOME:-}" ] || ! "${JAVA_HOME}/bin/java" -version 2>&1 | grep -qE '"(17|21)\.'; then
  for candidate in \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
    "/opt/homebrew/opt/openjdk@17" \
    "/opt/homebrew/opt/openjdk@21" \
    "/usr/lib/jvm/java-17-openjdk-amd64"
  do
    if [ -x "$candidate/bin/java" ]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME}/bin/java" ]; then
  cat >&2 <<'EOF'
No usable JDK found.

Gradle needs Java 17 or 21. Either install Android Studio (it bundles one), or:

  brew install openjdk@17

then re-run. To use a specific one:

  JAVA_HOME=/path/to/jdk npm run build:apk
EOF
  exit 1
fi

echo "JDK:  $("${JAVA_HOME}/bin/java" -version 2>&1 | head -1)  [$JAVA_HOME]"

# ---------------------------------------------------------------- Android SDK --

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ ! -d "$ANDROID_HOME" ]; then
  echo "No Android SDK at $ANDROID_HOME. Install it via Android Studio, or set ANDROID_HOME." >&2
  exit 1
fi
echo "SDK:  $ANDROID_HOME"

# ------------------------------------------------------------------- build --

# `/android` is generated, so regenerate it when it is missing. It is not
# regenerated otherwise: prebuild --clean wipes anything hand-edited in there.
if [ ! -d android ]; then
  echo "No android/ directory — running prebuild."
  npx expo prebuild --platform android --no-install
fi

echo "Building release APK…"
(cd android && ./gradlew assembleRelease)

OUT="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$OUT" ]; then
  echo "Gradle finished but $OUT is missing." >&2
  exit 1
fi

cp "$OUT" ./vybe.apk
echo
echo "Done: $(pwd)/vybe.apk  ($(du -h ./vybe.apk | cut -f1))"
echo "Install on a connected device with:  adb install -r vybe.apk"
