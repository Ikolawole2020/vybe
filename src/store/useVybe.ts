import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TOPICS } from '@/data/topics';
import { DEFAULT_DIALS } from '@/algo/engine';
import * as db from '@/services/db';
import { useAuth } from '@/store/useAuth';
import { notifyForFollowedPost } from '@/services/notifications';
import type {
  AgeRange,
  AlgoDials,
  AlgoLedgerEntry,
  AlgoState,
  Author,
  ChatConversation,
  Circle,
  DirectMessage,
  Draft,
  DraftPoll,
  FeedMode,
  Profile,
  Post,
  Space,
  Story,
  StoryItem,
  TemporaryMode,
  TopicId,
  VoiceNote,
} from '@/data/types';

let uid = 0;
const nextId = (p: string) => `${p}_${Date.now().toString(36)}_${++uid}`;

export type { AgeRange };

export const generateUUID = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

const initialTopicWeights: Record<TopicId, number> = {};

const EMPTY_PROFILE: Profile = { id: '', name: '', handle: '', avatar: '', bio: '', joinedAt: 0 };

const me = () => useAuth.getState().user?.id ?? null;

let inFlight: { userId: string; run: Promise<void> } | null = null;
let applyingRemote = false;

let algoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const ALGO_SAVE_DELAY = 1200;

export type AttentionBudget = {
  enabled: boolean;
  limitMinutes: number;
  spentSeconds: number;
  spentOn: string;
};

function today(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

type VybeState = {
  themePreference: 'system' | 'dark' | 'light';
  setThemePreference: (t: 'system' | 'dark' | 'light') => void;

  algo: AlgoState;
  circles: Circle[];
  posts: Post[];
  authors: Record<string, Author>;
  spaces: Space[];
  following: string[];
  followers: string[];
  joinedSpaceIds: string[];
  loading: boolean;
  refreshing: boolean;
  feedCursor: string | null;
  feedExhausted: boolean;
  loadingMore: boolean;
  loadMorePosts: () => Promise<void>;
  loadError: string | null;
  algoSyncedAt: number;

  sync: (opts?: { silent?: boolean }) => Promise<void>;
  cacheAuthors: (authors: Author[]) => void;
  clearAccountState: () => void;
  toggleFollow: (authorId: string) => void;
  toggleSpaceMember: (spaceId: string) => void;

  feedMode: FeedMode;
  seenIds: string[];
  liked: string[];
  saved: string[];
  boosted: string[];
  ledger: AlgoLedgerEntry[];
  budget: AttentionBudget;
  pendingDiffToken: number;
  unreadNotificationsCount: number;
  clearUnreadNotifications: () => void;
  setUnreadNotificationsCount: (n: number) => void;
  notifiedPostIds: string[];
  onboarded: boolean;
  onboardedFor: string | null;

  setFeedMode: (m: FeedMode) => void;
  markSeen: (id: string) => void;
  toggleLike: (id: string) => void;
  toggleSave: (id: string) => void;
  toggleBoost: (id: string) => void;

  setTopicWeight: (topic: TopicId, weight: number, source: AlgoLedgerEntry['source']) => void;
  setDial: (key: keyof AlgoDials, value: number) => void;
  nudgeAuthor: (authorId: string, delta: number, source: AlgoLedgerEntry['source']) => void;
  addMode: (mode: Omit<TemporaryMode, 'id' | 'startedAt'>) => void;
  removeMode: (id: string) => void;
  undoLedger: (entryId: string) => void;
  resetAlgo: () => void;

  addCircle: (name: string, color: string, glyph: string) => void;
  toggleCircleMember: (circleId: string, authorId: string) => void;
  setCircleBoost: (circleId: string, boost: number) => void;

  votePoll: (postId: string, optionId: string) => void;

  stories: Story[];
  seenStoryItemIds: string[];
  addStory: (item: Omit<StoryItem, 'id' | 'createdAt'>) => void;
  deleteStoryItem: (itemId: string) => void;
  hideStoryFromUser: (itemId: string, targetUserId: string) => void;
  markStorySeen: (authorId: string, itemId: string) => void;

  conversations: ChatConversation[];
  messages: Record<string, DirectMessage[]>;
  sendMessage: (
    conversationId: string,
    body: string,
    voiceNote?: VoiceNote,
    sharedPostId?: string,
    mediaUrl?: string,
  ) => void;
  startConversation: (targetAuthorId: string) => Promise<string | null>;
  markConversationRead: (conversationId: string) => void;

  addPost: (
    post: Omit<
      Post,
      'id' | 'createdAt' | 'likes' | 'comments' | 'boosts' | 'viralityRatio' | 'poll'
    > & { poll?: DraftPoll },
  ) => Promise<boolean>;
  removePost: (id: string) => Promise<void>;

  drafts: Draft[];
  saveDraft: (draft: Omit<Draft, 'id' | 'savedAt'> & { id?: string }) => Promise<void>;
  removeDraft: (id: string) => Promise<void>;

  spendAttention: (seconds: number) => void;
  setBudget: (patch: Partial<AttentionBudget>) => void;
  tourSeen: boolean;
  completeTour: () => void;
  replayTour: () => void;
  completeOnboarding: () => void;
  applySetup: (choice: SetupChoice) => void;
  applyPreset: (preset: SetupPreset) => void;

  profile: Profile;
  setProfile: (patch: Partial<Profile>) => Promise<string | null>;
  ageAskedFor: string | null;
  setAgeRange: (range: AgeRange | null) => Promise<void>;
  hydrated: boolean;
  setHydrated: () => void;
};

export type SetupPreset = 'calm' | 'balanced' | 'open';

export type SetupChoice = {
  more: TopicId[];
  less: TopicId[];
  preset: SetupPreset;
};

export const SETUP_PRESETS: Record<SetupPreset, { dials: AlgoDials; label: string; blurb: string }> =
  {
    calm: {
      label: 'Calm',
      blurb: 'Mostly people you chose. Popularity counts for nothing.',
      dials: {
        topicPull: 0.7,
        freshness: 0.5,
        crowd: 0,
        intimacy: 0.9,
        serendipity: 0.25,
        variety: 0.8,
      },
    },
    balanced: {
      label: 'Balanced',
      blurb: 'Your interests lead, with a steady stream of everything else.',
      dials: {
        topicPull: 0.75,
        freshness: 0.6,
        crowd: 0.2,
        intimacy: 0.7,
        serendipity: 0.4,
        variety: 0.6,
      },
    },
    open: {
      label: 'Open',
      blurb: 'Goes looking outside your list. Expect to disagree with it sometimes.',
      dials: {
        topicPull: 0.5,
        freshness: 0.7,
        crowd: 0.35,
        intimacy: 0.45,
        serendipity: 0.8,
        variety: 0.5,
      },
    },
  };

export function matchPreset(dials: AlgoDials): SetupPreset | null {
  const keys = Object.keys(dials) as (keyof AlgoDials)[];
  for (const name of Object.keys(SETUP_PRESETS) as SetupPreset[]) {
    const p = SETUP_PRESETS[name].dials;
    if (keys.every((k) => Math.abs(dials[k] - p[k]) < 0.02)) return name;
  }
  return null;
}

let readBack = false;

export const useVybe = create<VybeState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      setHydrated: () => set({ hydrated: true }),
      themePreference: 'dark',
      setThemePreference: (t) => set({ themePreference: t }),

      algo: {
        topicWeights: initialTopicWeights,
        authorWeights: {},
        dials: { ...DEFAULT_DIALS },
        modes: [],
      },
      circles: [],
      posts: [],
      authors: {},
      spaces: [],
      following: [],
      followers: [],
      joinedSpaceIds: [],
      loading: false,
      refreshing: false,
      loadError: null,
      algoSyncedAt: 0,
      feedCursor: null,
      feedExhausted: false,
      loadingMore: false,
      feedMode: 'for-you',
      seenIds: [],
      liked: [],
      saved: [],
      boosted: [],
      ledger: [],
      drafts: [],
      profile: EMPTY_PROFILE,
      budget: { enabled: true, limitMinutes: 30, spentSeconds: 0, spentOn: today() },
      pendingDiffToken: 0,
      unreadNotificationsCount: 0,
      clearUnreadNotifications: () => set({ unreadNotificationsCount: 0 }),
      setUnreadNotificationsCount: (n) => set({ unreadNotificationsCount: n }),
      notifiedPostIds: [],
      tourSeen: false,
      onboarded: false,
      onboardedFor: null,

      setFeedMode: (m) => set({ feedMode: m }),
      markSeen: (id) =>
        set((s) =>
          s.seenIds.includes(id)
            ? s
            : { seenIds: s.seenIds.length >= 1000 ? [...s.seenIds.slice(-999), id] : [...s.seenIds, id] },
        ),
      toggleLike: (id) => {
        const on = !get().liked.includes(id);
        set((s) => ({
          liked: on ? [...s.liked, id] : s.liked.filter((x) => x !== id),
          posts: s.posts.map((p) => (p.id === id ? { ...p, likes: Math.max(0, p.likes + (on ? 1 : -1)) } : p)),
        }));
        const uid = me();
        if (!uid) return;
        void db.setReaction('likes', id, uid, on).then((ok) => {
          if (ok) return;
          set((s) => ({
            liked: on ? s.liked.filter((x) => x !== id) : [...s.liked, id],
            posts: s.posts.map((p) =>
              p.id === id ? { ...p, likes: Math.max(0, p.likes + (on ? -1 : 1)) } : p,
            ),
          }));
        });
      },

      toggleSave: (id) => {
        const on = !get().saved.includes(id);
        set((s) => ({ saved: on ? [...s.saved, id] : s.saved.filter((x) => x !== id) }));
        const uid = me();
        if (!uid) return;
        void db.setReaction('saves', id, uid, on).then((ok) => {
          if (!ok) set((s) => ({ saved: on ? s.saved.filter((x) => x !== id) : [...s.saved, id] }));
        });
      },

      toggleBoost: (id) => {
        const on = !get().boosted.includes(id);
        set((s) => ({
          boosted: on ? [...s.boosted, id] : s.boosted.filter((x) => x !== id),
          posts: s.posts.map((p) =>
            p.id === id ? { ...p, boosts: Math.max(0, p.boosts + (on ? 1 : -1)) } : p,
          ),
        }));
        const uid = me();
        if (!uid) return;
        void db.setReaction('boosts', id, uid, on).then((ok) => {
          if (ok) return;
          set((s) => ({
            boosted: on ? s.boosted.filter((x) => x !== id) : [...s.boosted, id],
            posts: s.posts.map((p) =>
              p.id === id ? { ...p, boosts: Math.max(0, p.boosts + (on ? -1 : 1)) } : p,
            ),
          }));
        });
      },

      setTopicWeight: (topic, weight, source) =>
        set((s) => {
          const prev = s.algo.topicWeights[topic] ?? 0;
          const next = Math.max(-1, Math.min(1, weight));
          if (Math.abs(prev - next) < 0.001) return s;
          const label = TOPICS.find((t) => t.id === topic)?.label ?? topic;
          const entry: AlgoLedgerEntry = {
            id: nextId('led'),
            at: Date.now(),
            summary: `${next > prev ? 'Turned up' : 'Turned down'} ${label} to ${next >= 0 ? '+' : ''}${next.toFixed(2)}`,
            source,
            revert: { topicWeights: { [topic]: prev } },
            undone: false,
          };
          return {
            algo: { ...s.algo, topicWeights: { ...s.algo.topicWeights, [topic]: next } },
            ledger: [entry, ...s.ledger].slice(0, 60),
            pendingDiffToken: s.pendingDiffToken + 1,
          };
        }),

      setDial: (key, value) =>
        set((s) => {
          const prev = s.algo.dials[key];
          const next = Math.max(0, Math.min(1, value));
          if (Math.abs(prev - next) < 0.001) return s;
          const meta = key.replace(/([A-Z])/g, ' $1').toLowerCase();
          const entry: AlgoLedgerEntry = {
            id: nextId('led'),
            at: Date.now(),
            summary: `Set ${meta} to ${Math.round(next * 100)}%`,
            source: 'panel',
            revert: { dials: { [key]: prev } as Partial<AlgoDials> },
            undone: false,
          };
          return {
            algo: { ...s.algo, dials: { ...s.algo.dials, [key]: next } },
            ledger: [entry, ...s.ledger].slice(0, 60),
            pendingDiffToken: s.pendingDiffToken + 1,
          };
        }),

      nudgeAuthor: (authorId, delta, source) =>
        set((s) => {
          const prev = s.algo.authorWeights[authorId] ?? 0;
          const next = Math.max(-1, Math.min(1, prev + delta));
          const entry: AlgoLedgerEntry = {
            id: nextId('led'),
            at: Date.now(),
            summary: `${delta > 0 ? 'More' : 'Less'} from this account (${next >= 0 ? '+' : ''}${next.toFixed(2)})`,
            source,
            revert: { authorWeights: { [authorId]: prev } },
            undone: false,
          };
          return {
            algo: { ...s.algo, authorWeights: { ...s.algo.authorWeights, [authorId]: next } },
            ledger: [entry, ...s.ledger].slice(0, 60),
            pendingDiffToken: s.pendingDiffToken + 1,
          };
        }),

      addMode: (mode) =>
        set((s) => {
          const full: TemporaryMode = { ...mode, id: nextId('mode'), startedAt: Date.now() };
          const entry: AlgoLedgerEntry = {
            id: nextId('led'),
            at: Date.now(),
            summary: `Started "${full.label}" — expires ${new Date(full.expiresAt).toLocaleDateString()}`,
            source: 'mode',
            revert: { removeModeId: full.id },
            undone: false,
          };
          return {
            algo: { ...s.algo, modes: [...s.algo.modes, full] },
            ledger: [entry, ...s.ledger].slice(0, 60),
            pendingDiffToken: s.pendingDiffToken + 1,
          };
        }),

      removeMode: (id) =>
        set((s) => ({
          algo: { ...s.algo, modes: s.algo.modes.filter((m) => m.id !== id) },
          pendingDiffToken: s.pendingDiffToken + 1,
        })),

      undoLedger: (entryId) =>
        set((s) => {
          const entry = s.ledger.find((e) => e.id === entryId);
          if (!entry || entry.undone) return s;
          const algo = { ...s.algo };
          const r = entry.revert;
          if (r.topicWeights) algo.topicWeights = { ...algo.topicWeights, ...r.topicWeights };
          if (r.authorWeights) algo.authorWeights = { ...algo.authorWeights, ...r.authorWeights };
          if (r.dials) algo.dials = { ...algo.dials, ...r.dials };
          if (r.removeModeId) algo.modes = algo.modes.filter((m) => m.id !== r.removeModeId);
          if (r.addMode) algo.modes = [...algo.modes, r.addMode];
          if (r.restoreModes) algo.modes = [...r.restoreModes];
          return {
            algo,
            ledger: s.ledger.map((e) => (e.id === entryId ? { ...e, undone: true } : e)),
            pendingDiffToken: s.pendingDiffToken + 1,
          };
        }),

      resetAlgo: () =>
        set((s) => ({
          algo: {
            topicWeights: Object.fromEntries(TOPICS.map((t) => [t.id, 0])),
            authorWeights: {},
            dials: { ...DEFAULT_DIALS },
            modes: [],
          },
          ledger: (
            [
              {
                id: nextId('led'),
                at: Date.now(),
                summary: 'Reset the whole algorithm to neutral',
                source: 'panel',
                revert: {
                  topicWeights: { ...s.algo.topicWeights },
                  authorWeights: { ...s.algo.authorWeights },
                  dials: { ...s.algo.dials },
                  restoreModes: [...s.algo.modes],
                },
                undone: false,
              } satisfies AlgoLedgerEntry,
              ...s.ledger,
            ] as AlgoLedgerEntry[]
          ).slice(0, 60),
          pendingDiffToken: s.pendingDiffToken + 1,
        })),

      addCircle: (name, color, glyph) => {
        const uid = me();
        if (!uid) return;
        void db.createCircle(uid, name, color, glyph).then((circle) => {
          if (circle) set((s) => ({ circles: [...s.circles, circle] }));
        });
      },

      toggleCircleMember: (circleId, authorId) => {
        const on = !get().circles.find((c) => c.id === circleId)?.memberIds.includes(authorId);
        set((s) => ({
          circles: s.circles.map((c) =>
            c.id !== circleId
              ? c
              : {
                  ...c,
                  memberIds: on
                    ? [...c.memberIds, authorId]
                    : c.memberIds.filter((m) => m !== authorId),
                },
          ),
          pendingDiffToken: s.pendingDiffToken + 1,
        }));
        void db.setCircleMember(circleId, authorId, on).then((ok) => {
          if (ok) return;
          set((s) => ({
            circles: s.circles.map((c) =>
              c.id !== circleId
                ? c
                : {
                    ...c,
                    memberIds: on
                      ? c.memberIds.filter((m) => m !== authorId)
                      : [...c.memberIds, authorId],
                  },
            ),
          }));
        });
      },

      setCircleBoost: (circleId, boost) => {
        set((s) => ({
          circles: s.circles.map((c) => (c.id === circleId ? { ...c, boost } : c)),
          pendingDiffToken: s.pendingDiffToken + 1,
        }));
        void db.updateCircle(circleId, { boost });
      },

      votePoll: (postId, optionId) => {
        const uid = me();
        const before = get().posts.find((p) => p.id === postId)?.poll;
        if (!before || before.userVotedOptionId || !uid) return;

        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId || !p.poll || p.poll.userVotedOptionId) return p;
            const newOptions = p.poll.options.map((opt) =>
              opt.id === optionId ? { ...opt, votes: opt.votes + 1 } : opt,
            );
            return {
              ...p,
              poll: {
                ...p.poll,
                options: newOptions,
                userVotedOptionId: optionId,
                totalVotes: p.poll.totalVotes + 1,
              },
            };
          }),
        }));

        void db.castPollVote(before.id, optionId, uid).then((ok) => {
          if (ok) return;
          set((s) => ({
            posts: s.posts.map((p) => (p.id === postId && p.poll ? { ...p, poll: before } : p)),
          }));
        });
      },

      stories: [],

      addStory: (item) => {
        const uid = me() || get().profile.id;
        if (!uid) return;

        const newItem: StoryItem = { ...item, id: generateUUID(), createdAt: Date.now() };

        set((s) => {
          const mine = s.stories.find((st) => st.authorId === uid);
          if (mine) {
            return {
              stories: s.stories.map((st) =>
                st.id === mine.id ? { ...st, items: [...st.items, newItem] } : st,
              ),
            };
          }
          return {
            stories: [
              { id: `story_${uid}`, authorId: uid, items: [newItem], hasUnseen: false },
              ...s.stories,
            ],
          };
        });

        void (async () => {
          let remoteMediaUrl = item.media;
          if (!/^https?:\/\//.test(item.media)) {
            const uploaded = await db.uploadImage('post-media', uid, item.media);
            if (!uploaded) {
              set((s) => ({
                stories: s.stories
                  .map((st) => ({ ...st, items: st.items.filter((it) => it.id !== newItem.id) }))
                  .filter((st) => st.items.length > 0),
              }));
              return;
            }
            remoteMediaUrl = uploaded;
            set((s) => ({
              stories: s.stories.map((st) => ({
                ...st,
                items: st.items.map((it) =>
                  it.id === newItem.id ? { ...it, media: remoteMediaUrl } : it,
                ),
              })),
            }));
          }

          await db.createRemoteStoryItem({
            id: newItem.id,
            authorId: uid,
            mediaUrl: remoteMediaUrl,
            kind: item.kind,
            caption: item.caption,
            hiddenUserIds: item.hiddenUserIds,
          });
        })();
      },

      deleteStoryItem: (itemId) => {
        set((s) => ({
          stories: s.stories
            .map((st) => ({ ...st, items: st.items.filter((it) => it.id !== itemId) }))
            .filter((st) => st.items.length > 0),
        }));
        void db.deleteRemoteStoryItem(itemId);
      },

      hideStoryFromUser: (itemId, targetUserId) => {
        let next: string[] = [];
        set((s) => ({
          stories: s.stories.map((st) => ({
            ...st,
            items: st.items.map((it: StoryItem) => {
              if (it.id !== itemId) return it;
              const current = it.hiddenUserIds ?? [];
              next = current.includes(targetUserId)
                ? current.filter((id) => id !== targetUserId)
                : [...current, targetUserId];
              return { ...it, hiddenUserIds: next };
            }),
          })),
        }));
        void db.setStoryItemHiddenUsers(itemId, next);
      },

      seenStoryItemIds: [],
      markStorySeen: (authorId, itemId) => {
        const uid = me();
        if (uid && uid !== authorId) void db.recordStoryView(itemId, uid);

        set((s) => {
          const nextSeenIds = s.seenStoryItemIds.includes(itemId)
            ? s.seenStoryItemIds
            : [...s.seenStoryItemIds, itemId];
          return {
            seenStoryItemIds: nextSeenIds,
            stories: s.stories.map((st) => {
              if (st.authorId !== authorId) return st;
              const items = st.items.map((it: StoryItem) =>
                it.id === itemId || nextSeenIds.includes(it.id) ? { ...it, seen: true } : it
              );
              const hasUnseen = items.some((it: StoryItem) => !it.seen && !nextSeenIds.includes(it.id));
              return { ...st, items, hasUnseen };
            }),
          };
        });
      },

      conversations: [],
      messages: {},

     sendMessage: (conversationId, body, voiceNote, sharedPostId, mediaUrl) => {
        const uid = me();
        if (!uid) return;

        const msgId = generateUUID();

        const msg: DirectMessage = {
          id: msgId,
          conversationId,
          senderId: uid,
          body,
          createdAt: Date.now(),
          voiceNote,
          sharedPostId,
          media: mediaUrl,
          read: true,
          pending: true,
        };
        set((s) => ({
          messages: {
            ...s.messages,
            [conversationId]: [...(s.messages[conversationId] ?? []), msg],
          },
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, lastMessage: msg, unreadCount: 0 } : c,
          ),
        }));

        const markSettled = (failed: boolean, finalMediaUrl?: string) =>
          set((s) => ({
            messages: {
              ...s.messages,
              [conversationId]: (s.messages[conversationId] ?? []).map((m) =>
                m.id === msgId
                  ? {
                      ...m,
                      pending: false,
                      failed,
                      media: finalMediaUrl ?? m.media,
                    }
                  : m,
              ),
            },
          }));

        const attemptSend = async (retries = 3, delay = 1200): Promise<void> => {
          let remoteMediaUrl = mediaUrl;
          if (mediaUrl && !/^https?:\/\//.test(mediaUrl)) {
            const uploaded = await db.uploadImage('post-media', uid, mediaUrl);
            if (uploaded) {
              remoteMediaUrl = uploaded;
            }
          }

          const ok = await db.sendRemoteMessage({
            id: msgId,
            conversationId,
            senderId: uid,
            body,
            voiceUri: voiceNote?.uri,
            voiceDuration: voiceNote?.durationSeconds,
            sharedPostId,
            mediaUrl: remoteMediaUrl,
          });

          if (ok) {
            markSettled(false, remoteMediaUrl);
            return;
          }
          if (retries > 0) {
            await new Promise((r) => setTimeout(r, delay));
            return attemptSend(retries - 1, delay * 2);
          }
          markSettled(true);
        };
        void attemptSend();
      },

      startConversation: async (targetAuthorId) => {
        const uid = me();
        if (!uid) return null;

        const existing = get().conversations.find(
          (c) => !c.isCircleGroup && c.participantIds.includes(targetAuthorId),
        );
        if (existing) return existing.id;

        const remoteId = await db.createRemoteConversation(uid, targetAuthorId);
        if (!remoteId) return null;

        set((s) =>
          s.conversations.some((c) => c.id === remoteId)
            ? s
            : {
                conversations: [
                  { id: remoteId, participantIds: [targetAuthorId], unreadCount: 0 },
                  ...s.conversations,
                ],
                messages: { ...s.messages, [remoteId]: s.messages[remoteId] ?? [] },
              },
        );
        return remoteId;
      },

      markConversationRead: (conversationId) => {
        const uid = me();
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c,
          ),
        }));
        if (uid) void db.markConversationRead(conversationId, uid);
      },

      addPost: async (post) => {
        const uid = me();
        if (!uid) return false;
        const created = await db.createPost({
          authorId: uid,
          kind: post.kind,
          body: post.body,
          media: post.media,
          topics: post.topics,
          boundary: post.boundary,
          readSeconds: post.readSeconds,
          quotePostId: post.quotePostId,
        });
        if (!created) return false;

        const drafted = post.poll;
        let published = created;
        if (drafted && drafted.options.length >= 2) {
          const poll = await db.createPoll(created.id, drafted.question, drafted.options);
          if (poll) published = { ...created, poll };
        }

        set((s) => ({ posts: [published, ...s.posts] }));
        return true;
      },

      removePost: async (id) => {
        set((s) => ({ posts: s.posts.filter((p) => p.id !== id) }));
        await db.deletePost(id);
      },

      saveDraft: async ({ id, ...rest }) => {
        const uid = me();
        if (!uid) return;
        const saved = await db.upsertDraft(uid, { ...rest, id });
        if (!saved) return;
        set((s) => {
          const rest_ = s.drafts.filter((d) => d.id !== saved.id);
          return { drafts: [saved, ...rest_] };
        });
      },

      removeDraft: async (id) => {
        const ok = await db.deleteDraft(id);
        if (ok) set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }));
      },

      ageAskedFor: null,

      setAgeRange: async (range) => {
        const uid = me();
        set((s) => ({ ageAskedFor: uid, profile: { ...s.profile, ageRange: range ?? undefined } }));
        if (uid && range) await db.updateMyProfile(uid, { age_range: range });
      },

      setProfile: async (patch) => {
        const uid = me();
        if (!uid) return 'You are not signed in.';

        const res = await db.updateMyProfile(uid, {
          name: patch.name,
          handle: patch.handle,
          bio: patch.bio,
          avatar_url: patch.avatar,
        });
        if (!res.ok) return res.message;

        set((s) => ({ profile: { ...s.profile, ...patch } }));
        return null;
      },

      clearAccountState: () =>
        set({
          posts: [],
          authors: {},
          circles: [],
          spaces: [],
          drafts: [],
          following: [],
          joinedSpaceIds: [],
          liked: [],
          saved: [],
          boosted: [],
          seenIds: [],
          followers: [],
          profile: EMPTY_PROFILE,
          conversations: [],
          messages: {},
          stories: [],
          seenStoryItemIds: [],
          notifiedPostIds: [],
          unreadNotificationsCount: 0,
          algo: {
            topicWeights: initialTopicWeights,
            authorWeights: {},
            dials: { ...DEFAULT_DIALS },
            modes: [],
          },
          ledger: [],
          algoSyncedAt: 0,
          loading: false,
          refreshing: false,
          loadError: null,
          feedCursor: null,
          feedExhausted: false,
        }),

      cacheAuthors: (list) =>
        set((s) => {
          const authors = { ...s.authors };
          for (const a of list) authors[a.id] = { ...authors[a.id], ...a };
          return { authors };
        }),

      sync: async ({ silent } = {}) => {
        const user = useAuth.getState().user;
        if (!user) return;
        const uid = user.id;

        if (inFlight && inFlight.userId === uid) return inFlight.run;

        const run = async () => {
          set(silent ? { refreshing: true } : { loading: true, loadError: null });

          const [
            feed,
            circles,
            reactions,
            following,
            followers,
            profile,
            spaces,
            joined,
            drafts,
            remoteAlgo,
            remoteLedger,
            remoteConversations,
          ] = await Promise.all([
            db.fetchFeed(),
            db.fetchMyCircles(),
            db.fetchMyReactions(uid),
            db.fetchMyFollowing(uid),
            db.fetchMyFollowerIds(uid),
            db.ensureMyProfile(
              uid,
              user.email,
              ((user.user_metadata as { display_name?: string } | undefined)?.display_name ?? '').trim(),
            ),
            db.fetchSpaces(),
            db.fetchMySpaceIds(uid),
            db.fetchMyDrafts(),
            db.fetchAlgoState(uid),
            db.fetchLedger(uid),
            db.fetchRemoteConversations(uid),
          ]);

          const storyAudience = new Set<string>([uid, ...following]);
          for (const c of circles) for (const m of c.memberIds) storyAudience.add(m);
          const remoteStories = await db.fetchRemoteStories([...storyAudience], uid);

          const authors: Record<string, Author> = {};
          for (const a of feed.authors) {
            authors[a.id] = {
              ...a,
              following: following.includes(a.id),
              circles: circles.filter((c) => c.memberIds.includes(a.id)).map((c) => c.id),
            };
          }

          const missingAuthorIds = new Set<string>();
          for (const st of remoteStories) {
            if (!authors[st.authorId] && st.authorId !== uid) missingAuthorIds.add(st.authorId);
          }
          for (const conv of remoteConversations) {
            for (const pid of conv.participantIds) {
              if (!authors[pid] && pid !== uid) missingAuthorIds.add(pid);
            }
          }

          if (missingAuthorIds.size > 0) {
            try {
              const missingProfiles = await db.fetchProfilesByIds(Array.from(missingAuthorIds));
              for (const a of missingProfiles) {
                authors[a.id] = {
                  ...a,
                  following: following.includes(a.id),
                  circles: circles.filter((c) => c.memberIds.includes(a.id)).map((c) => c.id),
                };
              }
            } catch {}
          }

          const localIsNewer = !remoteAlgo || get().algoSyncedAt >= remoteAlgo.updatedAt;

          applyingRemote = true;
          try {
            set((s) => {
              const seenIds = s.seenStoryItemIds ?? [];
              const mergedStories = remoteStories.map((st) => {
                const items = (st.items ?? []).map((it) => ({
                  ...it,
                  seen: it.seen || seenIds.includes(it.id),
                }));
                return { ...st, items, hasUnseen: items.some((it) => !it.seen) };
              });

              return {
                posts: feed.posts,
                feedCursor: feed.nextCursor,
                feedExhausted: feed.nextCursor === null,
                authors: { ...s.authors, ...authors },
                circles,
                liked: reactions.liked,
                saved: reactions.saved,
                boosted: reactions.boosted,
                following,
                followers,
                spaces,
                joinedSpaceIds: joined,
                drafts,
                stories: mergedStories,
                conversations: (() => {
                  const remoteMap = new Map(remoteConversations.map((c) => [c.id, c]));
                  return remoteConversations.map((rc) => {
                    const local = s.conversations.find((lc) => lc.id === rc.id);
                    return local ? { ...rc, unreadCount: local.unreadCount } : rc;
                  }).concat(s.conversations.filter((lc) => !remoteMap.has(lc.id)));
                })(),
                profile: profile ?? s.profile,
                algo: localIsNewer ? s.algo : remoteAlgo.algo,
                ledger: localIsNewer ? s.ledger : remoteLedger,
                loading: false,
                refreshing: false,
                loadError: db.lastError,
              };
            });
          } finally {
            applyingRemote = false;
          }

          if (localIsNewer) {
            const stamp = await db.saveAlgoState(uid, get().algo);
            if (stamp) set({ algoSyncedAt: stamp });
            const ledger = get().ledger;
            if (ledger.length) void db.saveLedgerEntries(uid, ledger);
          } else {
            set({ algoSyncedAt: remoteAlgo.updatedAt });
          }
        };

        const started = run().finally(() => {
          if (inFlight?.run === started) inFlight = null;
        });
        inFlight = { userId: uid, run: started };
        return started;
      },

      loadMorePosts: async () => {
        const { loadingMore, feedExhausted, feedCursor, loading } = get();
        if (loadingMore || feedExhausted || loading || !feedCursor) return;

        set({ loadingMore: true });
        try {
          const page = await db.fetchFeed({ before: feedCursor });
          set((s) => {
            const known = new Set(s.posts.map((p) => p.id));
            const fresh = page.posts.filter((p) => !known.has(p.id));
            const authors = { ...s.authors };
            for (const a of page.authors) {
              authors[a.id] = { ...a, ...authors[a.id] };
            }
            return {
              posts: [...s.posts, ...fresh],
              authors,
              feedCursor: page.nextCursor,
              feedExhausted: page.nextCursor === null,
              loadingMore: false,
            };
          });
        } catch {
          set({ loadingMore: false });
        }
      },

      toggleFollow: (authorId) => {
        const uid = me();
        if (!uid) return;
        const on = !get().following.includes(authorId);
        set((s) => ({
          following: on ? [...s.following, authorId] : s.following.filter((x) => x !== authorId),
          authors: s.authors[authorId]
            ? {
                ...s.authors,
                [authorId]: {
                  ...s.authors[authorId],
                  following: on,
                  followers: Math.max(0, s.authors[authorId].followers + (on ? 1 : -1)),
                },
              }
            : s.authors,
        }));
        void db.setFollow(uid, authorId, on).then((ok) => {
          if (!ok) {
            set((s) => ({
              following: on ? s.following.filter((x) => x !== authorId) : [...s.following, authorId],
            }));
          }
        });
      },

      toggleSpaceMember: (spaceId) => {
        const uid = me();
        if (!uid) return;
        const on = !get().joinedSpaceIds.includes(spaceId);
        set((s) => ({
          joinedSpaceIds: on
            ? [...s.joinedSpaceIds, spaceId]
            : s.joinedSpaceIds.filter((x) => x !== spaceId),
          spaces: s.spaces.map((sp) =>
            sp.id === spaceId ? { ...sp, members: Math.max(0, sp.members + (on ? 1 : -1)) } : sp,
          ),
        }));
        void db.setSpaceMember(spaceId, uid, on).then((ok) => {
          if (!ok) {
            set((s) => ({
              joinedSpaceIds: on
                ? s.joinedSpaceIds.filter((x) => x !== spaceId)
                : [...s.joinedSpaceIds, spaceId],
            }));
          }
        });
      },

      applyPreset: (preset) =>
        set((s) => {
          const dials = { ...SETUP_PRESETS[preset].dials };
          const entry: AlgoLedgerEntry = {
            id: nextId('led'),
            at: Date.now(),
            summary: `Set your feed to ${SETUP_PRESETS[preset].label}`,
            source: 'panel',
            revert: { dials: { ...s.algo.dials } },
            undone: false,
          };
          return {
            algo: { ...s.algo, dials },
            ledger: [entry, ...s.ledger],
            pendingDiffToken: s.pendingDiffToken + 1,
          };
        }),

      spendAttention: (seconds) =>
        set((s) => {
          const day = today();
          const spent = s.budget.spentOn === day ? s.budget.spentSeconds : 0;
          return { budget: { ...s.budget, spentSeconds: spent + seconds, spentOn: day } };
        }),
      setBudget: (patch) => set((s) => ({ budget: { ...s.budget, ...patch } })),
      completeTour: () => set({ tourSeen: true }),
      replayTour: () => set({ tourSeen: false }),
      completeOnboarding: () => set({ onboarded: true, onboardedFor: me() }),

      applySetup: ({ more, less, preset }) =>
        set((s) => {
          const weights: Record<TopicId, number> = {};
          for (const t of TOPICS) {
            weights[t.id] = more.includes(t.id) ? 0.75 : less.includes(t.id) ? -0.6 : 0;
          }
          const dials = { ...SETUP_PRESETS[preset].dials };

          const entry: AlgoLedgerEntry = {
            id: nextId('led'),
            at: Date.now(),
            summary: `Set your feed up as ${SETUP_PRESETS[preset].label} — ${more.length} topics in, ${less.length} out`,
            source: 'panel',
            revert: { topicWeights: { ...s.algo.topicWeights }, dials: { ...s.algo.dials } },
            undone: false,
          };

          return {
            algo: { ...s.algo, topicWeights: weights, dials },
            ledger: [entry, ...s.ledger],
            pendingDiffToken: s.pendingDiffToken + 1,
            onboarded: true,
            onboardedFor: me(),
          };
        }),
    }),
    {
      name: 'vybe',
      storage: createJSONStorage(() => ({
        getItem: (k) => AsyncStorage.getItem(k).catch(() => null),
        setItem: (k, v) =>
          readBack ? AsyncStorage.setItem(k, v).catch(() => undefined) : Promise.resolve(),
        removeItem: (k) => AsyncStorage.removeItem(k).catch(() => undefined),
      })),
      partialize: (s) => ({
        themePreference: s.themePreference,
        tourSeen: s.tourSeen,
        onboarded: s.onboarded,
        algo: s.algo,
        ledger: s.ledger,
        budget: s.budget,
        onboardedFor: s.onboardedFor,
        ageAskedFor: s.ageAskedFor,
        algoSyncedAt: s.algoSyncedAt,
        notifiedPostIds: s.notifiedPostIds,
        seenStoryItemIds: s.seenStoryItemIds,
      }),
      onRehydrateStorage: () => (state) => {
        readBack = true;
        if (state) {
          const seen = state.seenStoryItemIds ?? [];
          if (seen.length > 2000) {
            useVybe.setState({ seenStoryItemIds: seen.slice(-2000) });
          }
          state.setHydrated();
        } else {
          useVybe.setState({ hydrated: true });
        }
      },
    },
  ),
);

useVybe.subscribe((state, prev) => {
  if (applyingRemote) return;

  const uid = me();
  if (!uid) return;

  if (state.algo !== prev.algo) {
    if (algoSaveTimer) clearTimeout(algoSaveTimer);
    algoSaveTimer = setTimeout(() => {
      algoSaveTimer = null;
      void db.saveAlgoState(uid, useVybe.getState().algo).then((stamp) => {
        if (stamp) useVybe.setState({ algoSyncedAt: stamp });
      });
    }, ALGO_SAVE_DELAY);
  }

  if (state.ledger !== prev.ledger) {
    const before = new Map(prev.ledger.map((e) => [e.id, e]));
    const changed = state.ledger.filter((e) => {
      const was = before.get(e.id);
      return !was || was.undone !== e.undone;
    });
    if (changed.length) void db.saveLedgerEntries(uid, changed);
  }
});

export function useAuthor(id: string | undefined) {
  const cached = useVybe((s) => (id ? s.authors[id] : undefined));
  const profile = useVybe((s) => s.profile);

  return useMemo(() => {
    if (cached) return cached;
    if (id && profile.id === id) {
      return {
        id,
        handle: profile.handle,
        name: profile.name,
        avatar: profile.avatar,
        bio: profile.bio,
        followers: 0,
        circles: [],
        following: false,
      } satisfies Author;
    }
    return undefined;
  }, [cached, id, profile]);
}

export function useMutualIds(): Set<string> {
  const following = useVybe((s) => s.following);
  const followers = useVybe((s) => s.followers);
  return useMemo(() => {
    const theirs = new Set(followers);
    return new Set(following.filter((id) => theirs.has(id)));
  }, [following, followers]);
}

export function usePost(id: string | undefined) {
  return useVybe((s) => (id ? s.posts.find((p) => p.id === id) : undefined));
}

export function budgetPressure(b: AttentionBudget): number {
  if (!b.enabled || b.limitMinutes <= 0) return 0;
  if (b.spentOn !== today()) return 0;
  return Math.max(0, Math.min(1, b.spentSeconds / (b.limitMinutes * 60)));
}

export const EARLY_ADOPTER_UNTIL = new Date('2026-10-01T00:00:00Z').getTime();

export function isEarlyAdopter(p: { joinedAt: number }): boolean {
  return p.joinedAt > 0 && p.joinedAt < EARLY_ADOPTER_UNTIL;
}