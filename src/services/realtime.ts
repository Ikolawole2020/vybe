import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useVybe } from '@/store/useVybe';
import { showToast } from '@/components/ui/InAppToast';
import { touchLastSeen } from '@/services/db';
import type { DirectMessage } from '@/data/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Realtime subscriptions.
 *
 * ## What this used to do, and why it could not ship
 *
 * Every client subscribed to **every INSERT on `posts`, globally**, and each
 * one triggered a full `fetchFeed()` — 200 posts with their media and
 * aggregates. With a million accounts, one person posting caused a million
 * clients to each pull the feed. The same shape applied to `story_items`, which
 * refetched the entire stories table on any change anywhere. That is not a slow
 * feature, it is a self-inflicted denial of service, and it scales with the
 * square of the user base.
 *
 * Three things fix it:
 *
 * - **Nothing global fans out to a refetch.** New posts arrive on the next
 *   pull-to-refresh or the next `loadMore`. A feed is not a chat window and
 *   nobody has asked for it to reorder itself under their finger — the app went
 *   to some trouble to stop exactly that (see the frozen ranking in the feed
 *   screen), and this subscription was quietly undoing it.
 * - **What does stay is filtered server-side and coalesced.** Messages are
 *   filtered to the viewer's own conversations; stories are refetched at most
 *   once every thirty seconds.
 * - **The socket follows the app's lifecycle.** It was left connected in the
 *   background, where it holds a wake-lock, drains battery, and reconnects into
 *   a token that expired while the phone was asleep.
 */

let appChannel: RealtimeChannel | null = null;
let appStateSub: { remove: () => void } | null = null;
/** The last-seen heartbeat, live only while the app is in the foreground. */
let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Coalesces the story refetch. Bursts are common — posting three items is three events. */
let storyTimer: ReturnType<typeof setTimeout> | null = null;
const STORY_REFRESH_MS = 30_000;
let lastStoryFetch = 0;

/**
 * Everyone whose stories the viewer is entitled to a tray bubble for: the
 * viewer, the people they follow, and the people they have filed in a Circle.
 */
function storyAudience(userId: string): string[] {
  const s = useVybe.getState();
  const ids = new Set<string>([userId]);
  for (const id of s.following) ids.add(id);
  for (const c of s.circles) for (const m of c.memberIds) ids.add(m);
  return [...ids];
}

function refreshStories(userId: string, immediate = false): void {
  if (storyTimer) return;
  const wait = immediate ? 0 : Math.max(0, STORY_REFRESH_MS - (Date.now() - lastStoryFetch));

  storyTimer = setTimeout(() => {
    storyTimer = null;
    lastStoryFetch = Date.now();
    // Imported at the point of use so this module does not pull the whole data
    // layer into the bundle graph ahead of the first screen.
    void import('@/services/db').then(({ fetchRemoteStories }) =>
      fetchRemoteStories(storyAudience(userId)).then((stories) => {
        useVybe.setState((s) => {
          const seen = s.seenStoryItemIds ?? [];
          return {
            stories: stories.map((st) => {
              const items = (st.items ?? []).map((it) => ({
                ...it,
                seen: it.seen || seen.includes(it.id),
              }));
              return { ...st, items, hasUnseen: items.some((it) => !it.seen) };
            }),
          };
        });
      }),
    );
  }, wait);
}

function teardown(): void {
  if (storyTimer) {
    clearTimeout(storyTimer);
    storyTimer = null;
  }
  if (appChannel) {
    void supabase?.removeChannel(appChannel);
    appChannel = null;
  }
}

function connect(userId: string): void {
  if (!supabase || appChannel) return;

  const channel = supabase.channel(`app:${userId}`, {
    config: { private: false },
  });

  /**
   * Incoming direct messages.
   *
   * Row-level security already stops the server sending messages from
   * conversations the viewer is not in, so this is not the access control — the
   * policies in `0006`/`0008` are. It is still worth checking the conversation
   * is one the client knows about: a message for a thread this device has never
   * loaded would otherwise create a phantom entry in the store with no
   * conversation row behind it.
   */
  channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages' },
    (payload) => {
      const row = payload.new as Record<string, any>;
      if (!row?.conversation_id || !row.id) return;

      const incoming: DirectMessage = {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        body: row.body ?? '',
        media: row.media_url ?? undefined,
        voiceNote: row.voice_url
          ? { uri: row.voice_url, durationSeconds: row.voice_duration ?? 5 }
          : undefined,
        sharedPostId: row.shared_post_id ?? undefined,
        createdAt: new Date(row.created_at).getTime(),
        read: row.sender_id === userId,
      };

      // Somebody else's message, arriving while the app is in front: the OS
      // will not raise a push for it, so the app says so itself.
      if (incoming.senderId !== userId) {
        const state = useVybe.getState();
        if (state.conversations.some((c) => c.id === incoming.conversationId)) {
          const who = state.authors[incoming.senderId];
          showToast({
            href: `/messages/${incoming.conversationId}`,
            title: who?.name ?? 'New message',
            body: incoming.body || (incoming.voiceNote ? 'Voice note' : incoming.media ? 'Photo' : 'Shared a post'),
            avatar: who?.avatar,
            silentOn: `/messages/${incoming.conversationId}`,
          });
        }
      }

      useVybe.setState((s) => {
        const known = s.conversations.some((c) => c.id === incoming.conversationId);
        if (!known) return s;

        const list = s.messages[incoming.conversationId] ?? [];
        const at = list.findIndex((m) => m.id === incoming.id);

        // Your own message is already on screen under this exact id — the client
        // mints it and the insert carries it. Reconciling rather than appending
        // is what stopped every sent message appearing twice; it also clears the
        // pending flag the moment the row lands, which is the "delivered" tick.
        const messages = at >= 0
          ? list.map((m, i) => (i === at ? { ...incoming, pending: false, failed: false, media: incoming.media || m.media } : m))
          : [...list, incoming];

        return {
          messages: { ...s.messages, [incoming.conversationId]: messages },
          conversations: s.conversations.map((conv) =>
            conv.id !== incoming.conversationId
              ? conv
              : {
                  ...conv,
                  lastMessage: incoming,
                  unreadCount:
                    row.sender_id === userId ? conv.unreadCount : conv.unreadCount + 1,
                },
          ),
        };
      });
    },
  );

  // Stories, coalesced. `*` rather than INSERT because a delete has to leave the
  // tray too, and the tray is small enough that refetching it is cheaper than
  // reconciling one row.
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'story_items' },
    () => refreshStories(userId),
  );

  /**
   * Notifications addressed to this account.
   */
  channel.on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'notifications' },
    (payload) => {
      const row = payload.new as Record<string, any>;
      if (!row || row.user_id !== userId) return;

      useVybe.setState((s) => ({
        unreadNotificationsCount: s.unreadNotificationsCount + 1,
      }));
    },
  );

  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('[realtime] channel', status);
    }
  });

  appChannel = channel;
}

/**
 * Opens the app-wide subscription and keeps it in step with the foreground.
 *
 * Returns the teardown, which the caller must run on sign-out or unmount.
 */
export function initAppRealtime(userId: string): () => void {
  if (!supabase || !userId) return () => {};

  teardown();
  appStateSub?.remove();
  if (heartbeat) clearInterval(heartbeat);

  connect(userId);

  /**
   * The last-seen heartbeat.
   *
   * Once a minute while the app is in front, and immediately on every return
   * to it. It rides along with the realtime lifecycle because the question it
   * answers — "is this person around?" — has exactly the same shape as the one
   * the socket already tracks, and because stopping it when the app leaves the
   * foreground is the entire point: a stamp written from the background would
   * report someone as present with the phone in their pocket.
   */
  void touchLastSeen(userId);
  heartbeat = setInterval(() => {
    if (AppState.currentState === 'active') void touchLastSeen(userId);
  }, 60_000);

  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      connect(userId);
      void touchLastSeen(userId);
      // Anything that happened while the app was asleep was missed — the socket
      // was closed. One catch-up read on return is what makes that invisible.
      refreshStories(userId, true);
    } else {
      // A websocket held open in the background keeps the radio awake and comes
      // back to a token that expired while the phone slept.
      teardown();
    }
  };

  appStateSub = AppState.addEventListener('change', onAppState);

  return () => {
    appStateSub?.remove();
    appStateSub = null;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    teardown();
  };
}

/**
 * What the other person is doing right now, if anything.
 *
 * `null` is idle. It is one field rather than two booleans on purpose: someone
 * cannot be typing and recording at once, and modelling it as two flags is how
 * you end up rendering both indicators at the same time when a "stopped"
 * message goes missing.
 */
export type ChatActivity = 'typing' | 'recording' | null;

/**
 * Live state of one conversation: what the other person is doing, and whether
 * they are here at all.
 *
 * Broadcast and presence rather than database columns. A keystroke is not a
 * fact worth writing down, and at any real scale a `typing` boolean on a row
 * would be a write per keypress per participant — the same shape this file
 * exists to keep out of the app.
 *
 * ## What "online" means here, and what it does not
 *
 * Presence is tracked on this conversation's own channel, joined when the chat
 * screen mounts and dropped when it unmounts. So the dot means **"they have
 * this conversation open"**, not "they have the app open somewhere".
 *
 * That is the narrower claim, and it is the deliberate one, for two reasons.
 * The honest one is scale: a single global presence channel puts every signed-in
 * account in one room and pushes a diff to all of them on every join and leave,
 * which is the fan-out this module's opening note is entirely about. The better
 * one is that the narrower fact is the more useful fact — in a chat, "they are
 * reading this now" is what the dot is being asked, and "their phone is
 * unlocked in another app" answers a question nobody had.
 *
 * Worth knowing when reading the UI: this cannot report "last seen", because
 * nothing here writes anything down. Offline is simply the absence of presence.
 */
export function subscribeToChatActivity(
  conversationId: string,
  myUserId: string,
  handlers: {
    onActivity: (payload: { userId: string; activity: ChatActivity }) => void;
    onPresence?: (userIds: string[]) => void;
  },
): { sendActivity: (activity: ChatActivity) => void; unsubscribe: () => void } {
  if (!supabase || !conversationId) {
    return { sendActivity: () => {}, unsubscribe: () => {} };
  }

  const channel = supabase.channel(`chat:${conversationId}`, {
    config: {
      broadcast: { self: false },
      // Keyed by user id so a second device belonging to the same person
      // collapses into one entry rather than reading as two people present.
      presence: { key: myUserId },
    },
  });

  channel.on('broadcast', { event: 'activity' }, (event) => {
    const payload = event.payload as { userId: string; activity: ChatActivity };
    if (payload && payload.userId !== myUserId) handlers.onActivity(payload);
  });

  const emitPresence = () => {
    if (!handlers.onPresence) return;
    // `presenceState()` is keyed by the presence key, which is the user id.
    handlers.onPresence(Object.keys(channel.presenceState()));
  };

  channel.on('presence', { event: 'sync' }, emitPresence);
  channel.on('presence', { event: 'join' }, emitPresence);
  channel.on('presence', { event: 'leave' }, emitPresence);

  channel.subscribe((status) => {
    // Tracking before the channel is subscribed is silently dropped, which is
    // why this lives in the callback rather than beside it.
    if (status === 'SUBSCRIBED') void channel.track({ at: Date.now() });
  });

  /*
   Presence follows the foreground, not the mounted screen.

   A chat screen stays mounted when the phone is locked or the app is swiped
   away, so tracking on mount alone would leave someone showing as "Online"
   with the handset face-down on a table — the dot would mean "opened this
   thread at some point today", which is worse than no dot at all because it
   is confidently wrong.

   Any activity is dropped on the way out for the same reason: a typing bubble
   is not something to leave running on someone else's screen after you have
   left.
  */
  const onAppState = (state: AppStateStatus) => {
    if (state === 'active') {
      void channel.track({ at: Date.now() });
    } else {
      sendActivity(null);
      void channel.untrack();
    }
  };
  const appState = AppState.addEventListener('change', onAppState);

  // Throttled. `onChangeText` fires on every keystroke and each one was a
  // packet; the indicator only needs to be refreshed faster than it expires.
  // A *change* of activity always goes immediately — it is the repeats that are
  // rate-limited, so switching from typing to recording is never delayed.
  let lastSent = 0;
  let lastValue: ChatActivity | undefined;

  const sendActivity = (activity: ChatActivity) => {
    const now = Date.now();
    if (activity === lastValue && now - lastSent < 1500) return;
    lastSent = now;
    lastValue = activity;
    void channel.send({
      type: 'broadcast',
      event: 'activity',
      payload: { userId: myUserId, activity },
    });
  };

  return {
    sendActivity,
    unsubscribe: () => {
      appState.remove();
      void supabase?.removeChannel(channel);
    },
  };
}