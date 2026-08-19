# Shipping changes

Two ways to get a change onto someone's phone. Most days it is the first one.

## Over the air — the everyday case

```bash
npx eas-cli@latest update --branch preview --message "what changed"
```

Takes about a minute. Testers get it the next time they open the app. No link,
no reinstall, nothing for them to do.

This carries **JavaScript and assets**: screens, styles, copy, logic, images.
Padding, colours, a bug fix, a whole new screen built from parts the app already
has — all of it goes this way.

Match `--branch` to the build people are holding: `preview` for the APK you
share, `production` for a store build.

## A new APK — when the native shell has to change

Needed when the change is not JavaScript:

- a new library with native code (`npx expo install <anything>`)
- a new permission, or an edit to `app.json` plugins
- an Expo SDK upgrade

```bash
npx eas-cli@latest build --platform android --profile preview
```

Finishes with a link to share. `preview` gives an APK; `production` gives an AAB
for Play.

### Bump `version` when you do

**This is the one thing to remember.** `runtimeVersion` is on the `appVersion`
policy, so compatibility is decided by `expo.version` in `app.json` — the
`"1.0.0"` string.

An APK only receives updates published under the same version. So when a change
needs a new APK, change that number too:

```json
"version": "1.0.1"
```

Then build. Old APKs stop receiving updates — which is what you want, because
those updates would call native code they do not have — and the new APK starts
its own line.

Forget, and the update goes to phones whose shell cannot run it. It works on
your machine, because you rebuilt; it crashes on theirs.

The stricter `fingerprint` policy exists to remove that footgun by computing
compatibility from the native project instead of a hand-typed number, and it
does not work here: `/android` and `/ios` are gitignored, so they exist on your
machine and not on the build server, the two fingerprints disagree, and every
build fails with *"Runtime version calculated on local machine not equal to
runtime version calculated during build."* It could be made to work by ignoring
those directories in a `fingerprint.config.js`. Until someone does that, the
number is manual.

## Building locally

Faster for testing on your own device, but the result is signed with the
**debug** key, so it will not install over an EAS build and cannot be shared as
a real release.

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 && export ANDROID_HOME=$HOME/Library/Android/sdk && cd android && ./gradlew assembleRelease
```

Lands at `android/app/build/outputs/apk/release/app-release.apk`.

Java 26 is the system JDK and Gradle for RN 0.86 rejects it — hence the
`JAVA_HOME`. Without it the build fails on an unsupported class file version.

Install to a connected phone:

```bash
$HOME/Library/Android/sdk/platform-tools/adb install -r vybe.apk
```

## The signing key

EAS holds it. It was created on the first `eas build` and is what lets one
install replace another.

Android will only replace an app with a version signed by the **same** key. So:

- Anyone still on an old debug-signed APK must uninstall before installing an
  EAS build. One time only.
- Never distribute a locally built APK as a release. It is signed with the debug
  key, so it cannot be updated afterwards — not over the air, not by a new APK.

`eas credentials` shows or downloads the key if it is ever needed elsewhere.

## Checking what actually shipped

A build finishing is not proof the new code is in it — Gradle caches
aggressively. To confirm a string from the change is really in the bundle:

```bash
python3 -c "d=open('android/app/build/generated/assets/react/release/index.android.bundle','rb').read(); s='some new string'; print(d.count(s.encode()) or d.count(s.encode('utf-16-le')))"
```

Both encodings, because Hermes stores any string containing a non-ASCII
character — an ellipsis, a curly quote — as UTF-16, where a plain `grep` will
not find it and will report a fresh build as stale.
