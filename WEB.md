# Vybe — Web version

This is the same Expo codebase running as a Progressive Web App / SPA.

## What works on web

- Full feed, Discover, Algo, Profile, Compose, Messages, Notifications, Circles, Time Machine, Ledger
- Auth (email + 6-digit code, password reset)
- Supabase session persistence via `localStorage` (AsyncStorage)
- Responsive mobile-first layout — works in mobile browsers
- Algorithm engine, Receipts, Genome, Boundaries (all client-side)

## What is intentionally limited on web

| Feature | Behaviour |
|---------|-----------|
| Liquid Glass | Falls back to solid elevated surface + border |
| Biometrics / Face ID | Hidden / unavailable |
| Haptics | No-op |
| Push notifications | Not available in browser (in-app still works) |
| Native image crop studio / some camera flows | May be restricted by browser permissions |
| Voice notes | Relies on browser `MediaRecorder` / `expo-audio` web support |

## Quick start

```bash
cp .env.example .env
# fill EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY

npm install --legacy-peer-deps
npx expo start --web
```

## Production build

```bash
npx expo export -p web
# → dist/
```

Deploy the `dist` folder to Vercel, Netlify, Cloudflare Pages, or any static host.

For Vercel you can also use the Expo web target with zero config after `expo export`.

## Changes made for web compatibility

1. `src/lib/secureStorage.ts` — platform branch: SecureStore on native, AsyncStorage on web.
2. `src/services/biometrics.ts` — all biometric paths return unavailable / no-op on web so the module never crashes the bundle.
3. Glass component already had a solid fallback for non-iOS/Android.
4. README + scripts updated (`web`, `export:web`).

The native iOS/Android experience is unchanged.
