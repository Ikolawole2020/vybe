import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Post, Author } from '@/data/types';

// Configure notification behavior when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * The answer to the permission question, cached for the process.
 *
 * The old version cached the *fact that it had asked* and then
 * `if (permissionsRequested) return true` — so once the prompt had been shown,
 * this reported permission granted whether or not it was. Every later caller
 * went on to schedule a notification that the OS silently dropped, and nothing
 * anywhere could tell that notifications were off.
 *
 * `null` means not yet determined, and a denial is remembered as a denial so
 * the user is not re-prompted on every post in their feed.
 */
let cached: boolean | null = null;

export async function requestNotificationPermissions(): Promise<boolean> {
  if (cached !== null) return cached;

  try {
    // The Android channel has to exist before the first notification, and
    // creating it does not require permission — doing it after the grant check
    // meant the very first notification on Android landed with no channel and
    // was dropped by the system.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'General',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#D2F34C', // Volt accent
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }

    cached = status === 'granted';
    return cached;
  } catch (err) {
    console.warn('[notifications] Failed to request permissions', err);
    cached = false;
    return false;
  }
}

/** Called after sign-out so the next account is asked afresh on this process. */
export function resetNotificationPermissionCache(): void {
  cached = null;
}

/**
 * Ids already notified about, bounded.
 *
 * These were unbounded `Set`s that only grew — a long-running session leaked
 * one entry per post seen and per profile viewed, forever. The cap drops the
 * oldest, which is correct here: a post old enough to fall out is one the user
 * has long since scrolled past.
 */
const notifiedPostIds = new Set<string>();
function remember(set: Set<string>, key: string, cap = 200): boolean {
  if (set.has(key)) return false;
  if (set.size >= cap) set.delete(set.values().next().value as string);
  set.add(key);
  return true;
}

/**
 * Notifies the user when someone they follow publishes a post.
 */
export async function notifyForFollowedPost(post: Post, author: Author): Promise<void> {
  if (!remember(notifiedPostIds, post.id)) return;

  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    const snippet = post.body ? (post.body.length > 80 ? post.body.slice(0, 77) + '...' : post.body) : 'Shared a new photo.';

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${author.name} (@${author.handle}) posted`,
        body: snippet,
        data: { postId: post.id, url: `/post/${post.id}` },
        sound: true,
      },
      trigger: null, // deliver immediately
    });
  } catch (err) {
    console.warn('[notifications] Failed to trigger notification', err);
  }
}

const notifiedProfileViews = new Set<string>();

/**
 * Notifies the user when someone views their profile.
 */
export async function notifyForProfileView(viewerName: string, viewerHandle: string, viewerId: string): Promise<void> {
  const key = `${viewerId}_${new Date().toDateString()}`;
  if (!remember(notifiedProfileViews, key)) return;

  try {
    const hasPermission = await requestNotificationPermissions();
    if (!hasPermission) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New Profile View 👀',
        body: `${viewerName} (@${viewerHandle}) viewed your profile`,
        data: { actorId: viewerId, url: `/profile-view/${viewerId}` },
        sound: true,
      },
      trigger: null, // deliver immediately
    });
  } catch (err) {
    console.warn('[notifications] Failed to trigger profile view notification', err);
  }
}
