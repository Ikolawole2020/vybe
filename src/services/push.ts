import { supabase } from '@/lib/supabase';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { requestNotificationPermissions } from '@/services/notifications';

/**
 * Push registration — the half of notifications that did not exist.
 *
 * There is deliberately no `expo-device` check for "is this a simulator". It is
 * the obvious way to write the guard and it costs a native module for one
 * boolean — and a native module that is imported but not in the binary throws
 * at module-evaluation time, which took the whole app down at launch rather
 * than skipping one registration. `getExpoPushTokenAsync` already rejects on a
 * simulator; catching that is the same guard with nothing to install.
 *
 * Before this, the only notification the app could produce was a *local* one
 * scheduled during `sync()`. A local notification is created by the device it
 * appears on, so it could never reach anybody else: nothing the user did on
 * their phone could ever put a banner on somebody else's. And because it fired
 * from `sync()`, it arrived while the user was already looking at the app, on
 * every launch, about the same post.
 *
 * A real notification is: something happens in the database → a row lands in
 * `notifications` → the server looks up the recipient's device tokens → Expo's
 * push service delivers to APNs or FCM → the banner appears whether or not the
 * app is running. This file is the client's contribution to that: obtaining the
 * token and keeping the server's copy current.
 */

/**
 * The EAS project id, which Expo's push service needs to route a token.
 *
 * `getExpoPushTokenAsync` will throw without it on a bare workflow build, and
 * the throw is unhelpful ("No projectId found"). Reading it from the manifest
 * covers both the classic and the EAS config shapes.
 */
function projectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/**
 * Obtains this device's push token and stores it against the signed-in account.
 *
 * Safe to call on every sign-in: the write is an upsert keyed on the token, so
 * a returning device updates its row rather than accumulating one per launch,
 * and a handset that changes hands reassigns the token to the new account
 * instead of quietly delivering the previous owner's notifications.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  if (!supabase || !userId) return null;

  const granted = await requestNotificationPermissions();
  if (!granted) return null;

  // No EAS project id means push cannot be routed and never will be until one
  // is configured. Returning early keeps that out of the log on every launch —
  // it was warning once per sign-in about a build-time configuration gap, which
  // trains people to ignore the log. Run `eas init` to fix it for real.
  const project = projectId();
  if (!project) return null;

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: project });
    if (!token) return null;

    const { error } = await supabase.from('device_tokens').upsert(
      {
        token,
        user_id: userId,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    if (error) {
      console.warn('[push] Could not store the device token', error.message);
      return null;
    }

    return token;
  } catch {
    // Expected on a simulator, which has no push service to register with.
    // Silent: it is the normal state of every development run.
    return null;
  }
}

/**
 * Drops this device's token on sign-out.
 *
 * Without it the row survives, and the next notification for the account that
 * left is delivered to a handset somebody else is now holding. The token itself
 * is looked up rather than remembered, because the value can be reissued by the
 * OS between launches.
 */
export async function unregisterPushToken(): Promise<void> {
  if (!supabase) return;
  const project = projectId();
  if (!project) return;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: project });
    if (token) await supabase.from('device_tokens').delete().eq('token', token);
  } catch {
    // The token could not be read, so there is nothing to revoke from here. The
    // server drops tokens that Expo reports as `DeviceNotRegistered` anyway.
  }
}
