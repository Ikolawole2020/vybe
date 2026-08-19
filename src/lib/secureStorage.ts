import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Encrypted-at-rest storage for the Supabase session on native.
 * On web we fall back to AsyncStorage (localStorage under the hood).
 *
 * The session was previously kept in `AsyncStorage`, which on both platforms is
 * an unencrypted file in the app sandbox. That is fine for a theme preference
 * and wrong for a bearer token on a phone: anything that can read the sandbox
 * gets a working access token. On web, the same AsyncStorage path is the
 * practical and expected place for SPA session persistence.
 *
 * `expo-secure-store` puts values in the iOS Keychain and the Android
 * EncryptedSharedPreferences/Keystore instead — native only.
 *
 * ## Why the chunking (native only)
 *
 * SecureStore's Android backend warns above 2048 bytes and can refuse outright.
 * A Supabase session is a JSON envelope around two JWTs and routinely exceeds
 * that once custom claims or a long email are involved, so a naive adapter
 * works on iOS, works on Android for short-lived test accounts, and then starts
 * silently failing to persist sessions in production. Values are split across
 * numbered keys and reassembled on read.
 */

const CHUNK = 1800;
const MANIFEST = (key: string) => `${key}__n`;
const PART = (key: string, i: number) => `${key}__${i}`;

const isWeb = Platform.OS === 'web';

type SecureStoreModule = typeof import('expo-secure-store');
let SecureStore: SecureStoreModule | null = null;

if (!isWeb) {
  // Dynamic require keeps the native module out of the web bundle evaluation path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SecureStore = require('expo-secure-store') as SecureStoreModule;
}

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` keeps the item out of iCloud Keychain and
 * out of encrypted backups, so restoring a backup onto a second handset does
 * not carry a live session with it.
 */
const OPTIONS: SecureStoreModule.SecureStoreOptions | undefined = !isWeb
  ? {
      keychainAccessible: SecureStore!.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }
  : undefined;

async function readChunked(key: string): Promise<string | null> {
  if (!SecureStore || !OPTIONS) return null;
  const manifest = await SecureStore.getItemAsync(MANIFEST(key), OPTIONS);
  if (manifest == null) return SecureStore.getItemAsync(key, OPTIONS);

  const count = Number(manifest);
  if (!Number.isFinite(count) || count <= 0) return null;

  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(PART(key, i), OPTIONS);
    // A missing chunk means a half-written value. Half a JWT is not a session,
    // so report nothing rather than hand back something that parses as garbage.
    if (part == null) return null;
    parts.push(part);
  }
  return parts.join('');
}

async function clearChunks(key: string): Promise<void> {
  if (!SecureStore || !OPTIONS) return;
  const manifest = await SecureStore.getItemAsync(MANIFEST(key), OPTIONS);
  if (manifest != null) {
    const count = Number(manifest) || 0;
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(PART(key, i), OPTIONS).catch(() => {});
    }
    await SecureStore.deleteItemAsync(MANIFEST(key), OPTIONS).catch(() => {});
  }
  await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => {});
}

async function writeChunked(key: string, value: string): Promise<void> {
  if (!SecureStore || !OPTIONS) return;
  await clearChunks(key);
  if (value.length <= CHUNK) {
    await SecureStore.setItemAsync(key, value, OPTIONS);
    return;
  }
  const count = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < count; i++) {
    await SecureStore.setItemAsync(PART(key, i), value.slice(i * CHUNK, (i + 1) * CHUNK), OPTIONS);
  }
  // The manifest is written last, so a write interrupted part-way leaves no
  // manifest and therefore reads as absent rather than as a truncated session.
  await SecureStore.setItemAsync(MANIFEST(key), String(count), OPTIONS);
}

/**
 * Storage adapter for `createClient({ auth: { storage } })`.
 *
 * Every method swallows its failure. A keychain that cannot be reached must
 * degrade to "signed out", never to a rejected promise — `useAuth.init()`
 * awaits `getSession()` and the splash screen is held until it resolves, so a
 * throw here is an app that never starts.
 *
 * On web we use AsyncStorage (localStorage) directly.
 */
export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (isWeb) {
        return await AsyncStorage.getItem(key);
      }

      const secure = await readChunked(key);
      if (secure != null) return secure;

      // One-time migration off the old plaintext location. Builds before this
      // change kept the session in AsyncStorage; reading it once and moving it
      // means existing users are not signed out by the upgrade.
      const legacy = await AsyncStorage.getItem(key);
      if (legacy != null) {
        await writeChunked(key, legacy).catch(() => {});
        await AsyncStorage.removeItem(key).catch(() => {});
        return legacy;
      }
      return null;
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    try {
      if (isWeb) {
        await AsyncStorage.setItem(key, value);
        return;
      }
      await writeChunked(key, value);
    } catch {
      // Nothing useful to do: the session simply will not survive a cold start.
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      if (isWeb) {
        await AsyncStorage.removeItem(key);
        return;
      }
      await clearChunks(key);
      await AsyncStorage.removeItem(key).catch(() => {});
    } catch {
      // As above.
    }
  },
};
