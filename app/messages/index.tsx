import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { fmtAge } from '@/algo/engine';
import { fetchProfilesByIds, searchProfiles } from '@/services/db';
import { useAuthor, useMutualIds, useVybe } from '@/store/useVybe';
import { useAuth } from '@/store/useAuth';
import type { Author, ChatConversation } from '@/data/types';

export default function MessagesInboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const params = useLocalSearchParams<{ sharePostId?: string }>();

  const conversations = useVybe((s) => s.conversations);
  const authors = useVybe((s) => s.authors);
  const sync = useVybe((s) => s.sync);
  const startConversation = useVybe((s) => s.startConversation);
  const sendMessage = useVybe((s) => s.sendMessage);
  const myId = useAuth((s) => s.user?.id) ?? 'me';

  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [newChatModal, setNewChatModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [tab, setTab] = useState<'chats' | 'requests'>('chats');
  const mutuals = useMutualIds();

  const onRefresh = async () => {
    setRefreshing(true);
    haptic('light');
    await sync({ silent: true });
    setRefreshing(false);
  };

  /**
   * Fills in the profiles the conversation list needs but the store has not
   * loaded.
   *
   * `asked` is what stops this looping forever. The effect wrote to `authors`,
   * `authors` was a dependency, so it re-ran — and when a lookup came back
   * empty, which it does for a deleted account or one the viewer cannot see,
   * the id stayed missing and the effect fetched it again on every render, for
   * as long as the screen was open.
   */
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const missing = conversations
      .map((conv) => conv.participantIds[0])
      .filter((pid): pid is string => Boolean(pid) && !authors[pid] && !asked.current.has(pid));
    if (missing.length === 0) return;

    for (const id of missing) asked.current.add(id);
    void fetchProfilesByIds(missing).then((list) => {
      if (list.length === 0) return;
      const next: Record<string, Author> = {};
      for (const a of list) next[a.id] = a;
      useVybe.setState((s) => ({ authors: { ...s.authors, ...next } }));
    });
  }, [conversations, authors]);

  /**
   * People you can start a conversation with: mutuals only.
   *
   * Two changes. It used to be `Object.values(authors)` — whoever's profile
   * happened to be loaded, which on a fresh account is nobody — so it is a
   * debounced server search now. And it is filtered to people you and they both
   * follow, which is the TikTok rule: a one-way follow is not a relationship,
   * and anyone can follow anyone, so a picker that offers strangers hands
   * control of somebody's inbox to whoever wants it.
   *
   * Messaging a non-mutual is still possible — from their profile, or by
   * replying to a story. It just does not start here, and it lands in Requests
   * rather than in the inbox. See `chats` / `requests` below.
   */
  const [people, setPeople] = useState<Author[]>([]);
  useEffect(() => {
    if (!newChatModal) return;
    let live = true;
    const t = setTimeout(() => {
      void searchProfiles(userSearch, 40, myId).then((list) => {
        if (live) setPeople(list.filter((a) => mutuals.has(a.id)));
      });
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [userSearch, newChatModal, myId, mutuals]);

  const filtered = conversations.filter((conv) => {
    if (!search.trim()) return true;
    const author = authors[conv.participantIds[0]];
    const q = search.toLowerCase();
    return (
      author?.name.toLowerCase().includes(q) ||
      author?.handle.toLowerCase().includes(q) ||
      conv.lastMessage?.body.toLowerCase().includes(q)
    );
  });

  /**
   * The inbox is mutuals; everything else is a request.
   *
   * A thread from somebody you do not both follow still exists and is still
   * readable — nothing is dropped — it is simply not mixed into the list you
   * check every day. That separation is the entire point: it means a stranger
   * can reach you without being able to interrupt you.
   *
   * Circle groups are always chats. They are a room you were deliberately put
   * in, and mutual-following is not the right question to ask of one.
   */
  const isChat = (conv: ChatConversation) =>
    conv.isCircleGroup || conv.participantIds.every((pid) => mutuals.has(pid));

  const chats = filtered.filter(isChat);
  const requests = filtered.filter((conv) => !isChat(conv));
  const shown = tab === 'requests' ? requests : chats;
  const requestUnread = requests.reduce((n, conv) => n + (conv.unreadCount > 0 ? 1 : 0), 0);

  const [starting, setStarting] = useState(false);

  const handleStartChat = async (targetAuthorId: string) => {
    if (starting) return;
    haptic('light');
    setStarting(true);
    const convId = await startConversation(targetAuthorId);
    setStarting(false);
    setNewChatModal(false);

    if (!convId) {
      Alert.alert('Could not open that chat', 'Check your connection and try again.');
      return;
    }
    if (params.sharePostId) {
      sendMessage(convId, 'Shared a post with you', undefined, params.sharePostId);
    }
    router.push(`/messages/${convId}` as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      {/* Masthead */}
      <View style={[styles.header, { paddingTop: insets.top + space.base }]}>
        <Touchable
          onPress={() => goBack()}
          feedback="light"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Icon name="chevron-left" size={24} color={c.text} />
        </Touchable>

        <VText variant="title">Messages</VText>

        <Touchable
          onPress={() => {
            haptic('light');
            setNewChatModal(true);
          }}
          feedback="select"
          hitSlop={10}
          style={[styles.composeBtn, { backgroundColor: c.surfaceElevated }]}
        >
          <Icon name="edit-3" size={18} color={c.volt} />
        </Touchable>
      </View>

      {/* Share post banner if sharing */}
      {params.sharePostId ? (
        <View style={[styles.shareBanner, { backgroundColor: c.surfaceElevated, borderColor: c.volt }]}>
          <Icon name="share-2" size={16} color={c.volt} />
          <VText variant="micro" color={c.volt}>
            Select a conversation to share post
          </VText>
        </View>
      ) : null}

      {/* Search Bar */}
      <View style={styles.searchWrap}>
        <View style={[styles.searchBox, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
          <Icon name="search" size={18} color={c.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: c.text }]}
            placeholder="Search conversations..."
            placeholderTextColor={c.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <Touchable onPress={() => setSearch('')} feedback="none">
              <Icon name="x" size={16} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>
      </View>

      {/*
        Chats / Requests. The strip only appears once a request exists — an
        empty second tab is a promise of content that is not there, and on an
        account nobody has messaged it is pure furniture.
      */}
      {requests.length > 0 ? (
        <View style={styles.tabsRow}>
          {(['chats', 'requests'] as const).map((t) => {
            const on = tab === t;
            return (
              <Touchable
                key={t}
                onPress={() => {
                  haptic('select');
                  setTab(t);
                }}
                feedback="none"
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[
                  styles.tabChip,
                  { backgroundColor: on ? c.volt : c.surfaceElevated },
                ]}
              >
                <VText variant="label" color={on ? c.onVolt : c.textSecondary}>
                  {t === 'chats' ? 'Chats' : `Requests${requestUnread ? ` (${requestUnread})` : ''}`}
                </VText>
              </Touchable>
            );
          })}
        </View>
      ) : null}

      {/* Conversations List */}
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.volt} />
        }
        contentContainerStyle={{
          paddingHorizontal: space.base,
          paddingBottom: insets.bottom + space.xl,
        }}
        renderItem={({ item }) => (
          <ConversationRow
            conversation={item}
            sharePostId={params.sharePostId}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: c.border }]} />
        )}
        ListEmptyComponent={
          tab === 'requests' ? (
            <View style={styles.empty}>
              <Icon name="inbox" size={36} color={c.textMuted} />
              <VText variant="body" secondary>
                No message requests
              </VText>
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="message-square" size={36} color={c.textMuted} />
              <VText variant="body" secondary>
                No conversations yet
              </VText>
              <VText variant="caption" muted style={{ textAlign: 'center', paddingHorizontal: space.xl }}>
                You can start a chat with anyone who follows you back. Anyone else can
                still reach you — their messages land in Requests.
              </VText>
              <Button
                label="Start a conversation"
                glyph="plus"
                variant="primary"
                onPress={() => setNewChatModal(true)}
                style={{ marginTop: space.sm }}
              />
            </View>
          )
        }
      />

      {/* New Conversation Modal Sheet */}
      <Modal
        visible={newChatModal}
        animationType="slide"
        transparent
        onRequestClose={() => setNewChatModal(false)}
      >
        {/*
          `behavior={undefined}` on Android is the stock component's way of
          saying "do nothing", so this sheet did not move for half the users.
          The keyboard-controller version has one behaviour on both platforms.
        */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {/* Tapping the dim area closes the sheet — see FollowListModal. */}
          <Pressable style={styles.modalBackdrop} onPress={() => setNewChatModal(false)}>
          <Pressable
            onPress={() => {}}
            accessible={false}
            style={[
              styles.modalSheet,
              {
                backgroundColor: c.surfaceElevated,
                paddingBottom: Math.max(insets.bottom, 24) + space.base,
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <VText variant="title">New Message</VText>
              <Touchable
                onPress={() => setNewChatModal(false)}
                feedback="light"
                style={styles.closeBtn}
                hitSlop={10}
              >
                <Icon name="x" size={22} color={c.text} />
              </Touchable>
            </View>

            <View style={[styles.searchBox, { backgroundColor: c.bg, borderColor: c.border, marginVertical: space.sm }]}>
              <Icon name="search" size={18} color={c.textMuted} />
              <TextInput
                style={[styles.searchInput, { color: c.text }]}
                placeholder="Search people..."
                placeholderTextColor={c.textMuted}
                value={userSearch}
                onChangeText={setUserSearch}
                autoFocus
              />
              {userSearch ? (
                <Touchable onPress={() => setUserSearch('')} feedback="none">
                  <Icon name="x" size={16} color={c.textMuted} />
                </Touchable>
              ) : null}
            </View>

            <FlatList
              data={people}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 380 }}
              renderItem={({ item }) => (
                <Touchable
                  onPress={() => handleStartChat(item.id)}
                  feedback="light"
                  style={styles.userRow}
                >
                  <Avatar uri={item.avatar} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <VText variant="bodyMedium">{item.name}</VText>
                    <VText variant="caption" muted>@{item.handle}</VText>
                  </View>
                  <Icon name="chevron-right" size={18} color={c.textMuted} />
                </Touchable>
              )}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: c.border, marginLeft: 56 }]} />
              )}
              ListEmptyComponent={
                <View style={[styles.empty, { paddingTop: 40, paddingHorizontal: space.lg }]}>
                  <VText variant="caption" muted style={{ textAlign: 'center' }}>
                    {userSearch.trim()
                      ? 'Nobody by that name follows you back yet.'
                      : 'You can start a chat with anyone who follows you back. Follow someone and wait for them to follow you, and they will show up here.'}
                  </VText>
                </View>
              }
              keyboardShouldPersistTaps="handled"
            />
          </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function ConversationRow({
  conversation,
  sharePostId,
}: {
  conversation: ChatConversation;
  sharePostId?: string;
}) {
  const { c } = useTheme();
  const router = useRouter();
  const author = useAuthor(conversation.participantIds[0]);
  const circles = useVybe((s) => s.circles);
  const sendMessage = useVybe((s) => s.sendMessage);

  const memberCircle = circles.find((cc) => cc.memberIds.includes(conversation.participantIds[0]));

  const handleOpen = () => {
    haptic('light');
    if (sharePostId) {
      sendMessage(conversation.id, 'Shared a post with you', undefined, sharePostId);
    }
    router.push(`/messages/${conversation.id}` as any);
  };

  return (
    <Touchable
      onPress={handleOpen}
      feedback="light"
      scaleTo={0.98}
      style={styles.row}
    >
      <Avatar uri={author?.avatar ?? ''} size={50} ring={memberCircle?.color} />

      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <View style={styles.nameRow}>
            <VText variant="bodyMedium" numberOfLines={1}>
              {author?.name ?? 'Chat'}
            </VText>
            {memberCircle ? (
              <View style={[styles.circleBadge, { backgroundColor: memberCircle.color + '22' }]}>
                <VText variant="micro" color={memberCircle.color}>
                  {memberCircle.name}
                </VText>
              </View>
            ) : null}
          </View>

          {conversation.lastMessage ? (
            <VText variant="micro" muted>
              {fmtAge((Date.now() - conversation.lastMessage.createdAt) / 3600_000)}
            </VText>
          ) : null}
        </View>

        <View style={styles.rowBottom}>
          <VText
            variant="body"
            color={conversation.unreadCount > 0 ? c.text : c.textSecondary}
            numberOfLines={1}
            style={{ flex: 1, fontWeight: conversation.unreadCount > 0 ? '600' : '400' }}
          >
            {conversation.lastMessage?.body ?? 'No messages yet'}
          </VText>

          {conversation.unreadCount > 0 ? (
            <View style={[styles.unreadBadge, { backgroundColor: c.volt }]}>
              <VText variant="micro" color={c.onVolt} style={{ fontWeight: '700' }}>
                {conversation.unreadCount}
              </VText>
            </View>
          ) : null}
        </View>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.base,
    paddingBottom: space.md,
  },
  backBtn: {
    minHeight: 40,
    justifyContent: 'center',
  },
  shareBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.base,
    marginBottom: space.sm,
    padding: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.base,
    paddingBottom: space.md,
  },
  tabChip: {
    paddingHorizontal: space.base,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    paddingHorizontal: space.base,
    marginBottom: space.md,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: radius.lg,
    paddingHorizontal: space.base,
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
  rowContent: {
    flex: 1,
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  circleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unreadBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 66,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingTop: 80,
  },
  composeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingTop: space.base,
    paddingHorizontal: space.base,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  closeBtn: {
    padding: space.xs,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
});
