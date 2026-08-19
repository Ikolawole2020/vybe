# Vybe

**Your Social Experience, Your Rules.**

A cross-platform social app (iOS + Android) that blends Instagram's visual feed with X's conversational one — and hands the algorithm to the user. Every post can explain, in arithmetic, why it reached you, and every explanation is one tap from being changed.

See [PRD.md](PRD.md) for the full product document.

## Running it

```bash
npm install --legacy-peer-deps
```

### Web (desktop + mobile browsers)

The app is fully usable in the browser. Glass falls back to solid/elevated surfaces, biometrics are disabled, and session storage uses `localStorage` via AsyncStorage.

```bash
npx expo start --web
```

Or open the web target directly after starting Metro:

```bash
npx expo start
# then press `w`
```

**Production static export** (works on any static host or Vercel/Netlify):

```bash
npx expo export -p web
# output lands in `dist/`
```

Serve the `dist` folder with any static server. The layout is mobile-first and works well on phone browsers.

### iOS

Requires Xcode 26+; Liquid Glass needs an iOS 26 simulator or device:

```bash
npx expo run:ios
```

### Android

```bash
npx expo run:android
```

Native builds are required for the full experience — `expo-glass-effect`, Reanimated, and Gesture Handler are not available in Expo Go. The web build intentionally degrades those features.

> If CocoaPods fails with a Unicode normalization error on Ruby 4.x, run `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` before `pod install`.

### Supabase

Copy `.env.example` to `.env` and fill in your project URL and anon key. Without
them the app runs signed-out against seeded data — a supported state, not an error.

**Sign-up confirms with a six-digit code, and that needs one dashboard change.**
Supabase's default *Confirm signup* template emails `{{ .ConfirmationURL }}`, a
link — a project left on the default sends no code and the verify screen has
nothing to accept. Paste
[`supabase/templates/confirm-signup.html`](supabase/templates/confirm-signup.html)
into **Authentication → Email Templates → Confirm signup**.

`{{ .Token }}` is the six-digit code itself, not a URL. It goes in the body as
text — putting it in an `href` produces a dead link to a relative path named after
the code, which is the easiest mistake to make here.

**Password reset works the same way, and needs the same change.** Paste
[`supabase/templates/reset-password.html`](supabase/templates/reset-password.html)
into **Authentication → Email Templates → Reset password**. Left on the default
the email carries a link that opens a browser, which on a phone is a dead end —
the app has no web session to hand the recovery token to. A code the user types
back into the reset screen has no such problem and needs no deep link.

### SMTP

The built-in email service sends **2 messages an hour, only to your own team
members** — enough to prove the flow works and not enough to test it properly.
Custom SMTP raises that to 30/hour, tunable under **Authentication → Rate Limits**.

Gmail, under **Project Settings → Authentication → SMTP Settings**:

| Field | Value |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `587` (STARTTLS) — `465` if you prefer SSL |
| Username | the full Google address |
| Password | a 16-character **App Password**, never the account password |
| Sender email | the same address as the username |
| Sender name | Vybe |

The App Password comes from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
and needs 2-Step Verification switched on first. It is revoked whenever the Google
account password changes, so a mysteriously dead sign-up flow months from now is
worth checking here first.

Two limits worth knowing before this reaches anyone: Gmail sends ~500 messages a
day on a consumer account and 2,000 on Workspace, and it rewrites the From header
to the authenticated account unless the sender address is a verified *Send mail as*
alias. Gmail is fine for a beta. Production auth mail wants a transactional
provider on your own domain with SPF and DKIM — deliverability on a `gmail.com`
sender is the thing that quietly puts confirmation codes in spam.

SMTP credentials belong in the Supabase dashboard only. Unlike the anon key, they
are not safe to ship — nothing here goes in `.env`.

## What's here

| Path | What it is |
|---|---|
| `src/algo/engine.ts` | The ranking engine. Eight explainable terms, no hidden ones. Start here. |
| `src/theme/tokens.ts` | Design tokens — dark-first, volt/pulse/ember semantics |
| `src/components/glass/Glass.tsx` | One surface, three implementations: iOS 26 Liquid Glass → blur → solid |
| `src/components/feed/Receipt.tsx` | "Why am I seeing this" — score decomposition + inline tuning |
| `src/components/algo/FeedGenome.tsx` | Topic weights as a draggable constellation |
| `src/components/compose/BoundaryDial.tsx` | Radial audience control: who can see vs who can reply |
| `app/time-machine.tsx` | Runs your posts through a different algorithm |
| `src/store/useVybe.ts` | App state, including the reversible algorithm ledger |

## The five things worth looking at

1. **Receipts** — tap the strip under any post. Every term, its signal, your weight, and what it contributed. Then change it from the same panel.
2. **The Time Machine** — Feed header → the rewind icon. Pick "The Engagement Machine" to see the feed a conventional platform would have built from the same posts.
3. **The Feed Genome** — Your Algo → Genome. Drag topics toward you to see more of them.
4. **The Boundaries dial** — compose a post, tap Next. Drag the eye down to widen who sees it, the bubble up to narrow who can reply.
5. **`@my_algo`** — open any post and reply with "@my_algo show me less like this". It posts publicly *and* retunes the feed, live.

## State of the build

v1 runs entirely client-side against a seeded dataset — including the ranking engine, which is the point rather than a shortcut (see PRD §5.1). The backend, auth, and media pipeline are v1.1; server-side Boundary enforcement is a hard requirement before any beta.
