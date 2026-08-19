import { AppState } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secureSessionStorage } from '@/lib/secureStorage';

/**
 * Supabase client.
 *
 * Credentials come from `EXPO_PUBLIC_` env vars, which Expo inlines at build
 * time — see `.env.example`. The anon key is safe to ship: it is the public
 * key, and every table it can reach must be protected by row-level security.
 * Nothing here is a substitute for RLS policies on the server.
 *
 * The client is created lazily and may legitimately be absent. Until a project
 * is configured the app runs entirely on seeded local data, so `isConfigured`
 * is a supported state rather than an error — call sites branch on it instead
 * of crashing a screen that has no backend to talk to yet.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        // The session is a bearer token, so it lives in the Keychain / Android
        // Keystore rather than in the unencrypted AsyncStorage file it used to
        // sit in. See `lib/secureStorage.ts` — it migrates the old location on
        // first read, so this change does not sign anybody out.
        storage: secureSessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        // There is no URL bar to read a session out of on a native client, and
        // leaving this on makes the SDK wait on a browser API that never
        // answers.
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Refresh tokens only tick while the app is in front.
 *
 * Left running in the background the timer fires against a suspended socket
 * and the session can land expired; stopping it on background and restarting
 * on active is the behaviour Supabase expects from a React Native client.
 */
if (supabase) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
