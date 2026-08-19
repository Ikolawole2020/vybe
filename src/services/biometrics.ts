import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Face ID / fingerprint sign-in.
 *
 * Fully disabled on web — there is no reliable cross-browser biometric API
 * that matches the native Keychain/Keystore model used here, and the feature
 * is native-only by design. All public functions return "unavailable" or
 * no-op on Platform.OS === 'web'.
 *
 * ## Why this stores credentials again (native)
 *
 * The previous version kept the Supabase **refresh token** instead of the
 * password, on the reasoning that a rotating token is a smaller thing to lose
 * than a reused password. The reasoning was sound and the mechanism did not
 * work, for a reason that is only visible in GoTrue's source: signing out with
 * `scope: 'local'` is not a local operation. It POSTs `/logout?scope=local`,
 * and GoTrue's "local" scope *deletes the current session row* — the very
 * session the remembered refresh token belongs to.
 *
 * So the sequence the user actually performs — sign in, sign out, come back and
 * press Face ID — revoked the credential on the way out every single time. The
 * button then failed with "that saved sign-in has expired", cleared itself, and
 * the only way to make it work again was to sign in with a password and *not*
 * sign out, which is not a thing anyone does. There is no supabase-js option
 * for a sign-out that skips the server, and no way to mint a second session
 * without the password, so the token approach cannot be repaired — a stored
 * session credential and a sign-out button are mutually exclusive here.
 *
 * What is stored now is the email and password, in the iOS Keychain / Android
 * Keystore via `expo-secure-store`, marked device-only so they are not carried
 * into iCloud or an encrypted backup, and read only after the OS biometric
 * prompt has succeeded. Signing in replays an ordinary password sign-in, which
 * is independent of session lifetime and therefore survives sign-out.
 *
 * Two things this is **not** a return to: the old build wrote the password to
 * `AsyncStorage` in clear text as well — an unencrypted file in the sandbox, in
 * every device backup — and that copy is still purged on launch, see
 * `purgeLegacyCredentials`. And nothing is saved unless the user answers yes to
 * the prompt on the sign-in screen; it is opt-in, and "Sign out and forget this
 * device" deletes it.
 */

const isWeb = Platform.OS === 'web';

const KEY_SECRET = 'vybe_bio_secret';
const KEY_EMAIL = 'vybe_bio_email';

/** Written by builds up to 16 Aug 2026 — plaintext, in the sandbox. */
const LEGACY_ASYNC_KEYS = ['vybe_bio_email', 'vybe_bio_password'];
/** The refresh-token attempt, and the SecureStore password entry that preceded it. */
const LEGACY_SECURE_KEYS = ['vybe_bio_password', 'vybe_bio_refresh_token'];

type SecureStoreModule = typeof import('expo-secure-store');
type LocalAuthModule = typeof import('expo-local-authentication');

let SecureStore: SecureStoreModule | null = null;
let LocalAuthentication: LocalAuthModule | null = null;

if (!isWeb) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  SecureStore = require('expo-secure-store') as SecureStoreModule;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  LocalAuthentication = require('expo-local-authentication') as LocalAuthModule;
}

const OPTIONS: SecureStoreModule.SecureStoreOptions | undefined = !isWeb
  ? {
      keychainAccessible: SecureStore!.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }
  : undefined;

/**
 * What to call the thing on this device.
 *
 * "Face ID" and "Touch ID" are Apple's names for Apple's hardware. Android
 * phones report `FACIAL_RECOGNITION` freely — most of them for the camera
 * unlock that is not even strong enough for `BiometricPrompt` — and labelling
 * that "Face ID" is wrong twice over: it names someone else's product, and it
 * promises a face scan on a handset that is about to ask for a fingerprint.
 */
export type BiometryType = 'Face ID' | 'Touch ID' | 'Face Unlock' | 'Fingerprint' | 'Biometrics';

/** Whether the label refers to a face, which is all the icon needs to know. */
export function isFaceBiometry(type: BiometryType): boolean {
  return type === 'Face ID' || type === 'Face Unlock';
}

function labelFor(types: number[]): BiometryType {
  if (!LocalAuthentication) return 'Biometrics';
  const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

  if (Platform.OS === 'ios') {
    if (face) return 'Face ID';
    if (finger) return 'Touch ID';
    return 'Biometrics';
  }

  // Fingerprint first on Android: where a device reports both, the fingerprint
  // reader is the one `BiometricPrompt` will actually use.
  if (finger) return 'Fingerprint';
  if (face) return 'Face Unlock';
  return 'Biometrics';
}

/**
 * Deletes what earlier builds left on disk.
 *
 * Shipping a fix is not the same as undoing the damage: every device that ran
 * the old build still has the plaintext file. This runs unconditionally at
 * startup, costs a handful of absent-key reads on a clean install, and is the
 * only way those values ever leave those handsets.
 */
export async function purgeLegacyCredentials(): Promise<void> {
  const tasks: Promise<unknown>[] = [
    ...LEGACY_ASYNC_KEYS.map((k) => AsyncStorage.removeItem(k).catch(() => {})),
  ];
  if (SecureStore && OPTIONS) {
    tasks.push(
      ...LEGACY_SECURE_KEYS.map((k) => SecureStore!.deleteItemAsync(k, OPTIONS).catch(() => {})),
    );
  }
  await Promise.all(tasks);
}

export async function checkBiometricsSupport(): Promise<{
  supported: boolean;
  enrolled: boolean;
  biometryType: BiometryType;
  hasSavedCredentials: boolean;
}> {
  const unavailable = {
    supported: false,
    enrolled: false,
    biometryType: 'Biometrics' as BiometryType,
    hasSavedCredentials: false,
  };

  if (isWeb || !LocalAuthentication) return unavailable;

  try {
    // Hardware and enrolment are separate facts and both are required. The old
    // code OR-ed them together, so a phone with a fingerprint reader and no
    // finger registered reported itself ready and then failed at the prompt.
    const [supported, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);

    return {
      supported,
      enrolled,
      biometryType: labelFor(types),
      hasSavedCredentials: await hasRememberedCredentials(),
    };
  } catch {
    // Claiming support we could not confirm puts a Face ID button on a device
    // that has none, and the button can only fail.
    return unavailable;
  }
}

/** Stores the credentials so the next sign-in can be a biometric one. */
export async function rememberCredentials(email: string, password: string): Promise<boolean> {
  if (isWeb || !SecureStore || !OPTIONS) return false;
  if (!email || !password) return false;
  try {
    await SecureStore.setItemAsync(KEY_EMAIL, email.trim().toLowerCase(), OPTIONS);
    await SecureStore.setItemAsync(KEY_SECRET, password, OPTIONS);
    return true;
  } catch (err) {
    console.warn('[biometrics] Could not save credentials', err);
    return false;
  }
}

export async function hasRememberedCredentials(): Promise<boolean> {
  if (isWeb || !SecureStore || !OPTIONS) return false;
  try {
    return Boolean(await SecureStore.getItemAsync(KEY_SECRET, OPTIONS));
  } catch {
    return false;
  }
}

/** The email the saved credential belongs to, for the sign-in screen to show. */
export async function getRememberedEmail(): Promise<string | null> {
  if (isWeb || !SecureStore || !OPTIONS) return null;
  try {
    return await SecureStore.getItemAsync(KEY_EMAIL, OPTIONS);
  } catch {
    return null;
  }
}

/**
 * Why an unlock did not produce a credential.
 *
 * These were once collapsed into `null`, and the caller could only say one
 * thing — "sign in with your password once and Face ID will work from then on".
 * So somebody whose scan simply failed or was cancelled was told to go and do
 * the thing they had already done. They are separate outcomes with separate
 * remedies and the UI has to be able to tell them apart.
 */
export type UnlockResult =
  /** Nothing stored. The password path is genuinely the only way forward. */
  | { status: 'no-credential' }
  /** No hardware, or nothing enrolled on this device. */
  | { status: 'unavailable' }
  /** The prompt was shown and did not succeed — a bad scan, or Cancel. */
  | { status: 'rejected' }
  | { status: 'ok'; email: string; password: string };

/**
 * The saved credentials, released only after a successful biometric check.
 *
 * Gating the *read* rather than gating a later branch is the point: a caller
 * that skips the prompt gets nothing to work with, so there is no code path
 * where the password is in memory without the user having proved who they are.
 *
 * The credential is checked for *before* the prompt. Asking someone to scan
 * their face and only then telling them there was nothing to unlock is a wasted
 * interaction and reads as a failure.
 */
export async function unlockRememberedCredentials(
  biometryType: BiometryType = 'Biometrics',
): Promise<UnlockResult> {
  if (isWeb || !SecureStore || !OPTIONS) return { status: 'unavailable' };

  let email: string | null = null;
  let password: string | null = null;
  try {
    email = await SecureStore.getItemAsync(KEY_EMAIL, OPTIONS);
    password = await SecureStore.getItemAsync(KEY_SECRET, OPTIONS);
  } catch {
    password = null;
  }
  if (!email || !password) return { status: 'no-credential' };

  const { supported, enrolled } = await checkBiometricsSupport();
  if (!supported || !enrolled) return { status: 'unavailable' };

  const passed = await authenticateWithBiometrics(biometryType);
  if (!passed) return { status: 'rejected' };

  return { status: 'ok', email, password };
}

export async function clearBiometricCredentials(): Promise<void> {
  const tasks: Promise<unknown>[] = [
    ...LEGACY_ASYNC_KEYS.map((k) => AsyncStorage.removeItem(k).catch(() => {})),
  ];
  if (SecureStore && OPTIONS) {
    tasks.push(
      SecureStore.deleteItemAsync(KEY_SECRET, OPTIONS).catch(() => {}),
      SecureStore.deleteItemAsync(KEY_EMAIL, OPTIONS).catch(() => {}),
    );
  }
  await Promise.all(tasks);
}

export async function authenticateWithBiometrics(
  biometryType: BiometryType = 'Biometrics',
): Promise<boolean> {
  if (isWeb || !LocalAuthentication) return false;
  try {
    const [supported, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (!supported || !enrolled) return false;

    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: `Sign in to Vybe with ${biometryType}`,
      fallbackLabel: 'Enter password',
      cancelLabel: 'Cancel',
      // Biometrics only. The device passcode is a different assurance level and
      // the app has its own password field for the fallback.
      disableDeviceFallback: true,
    });
    return res.success;
  } catch {
    return false;
  }
}
