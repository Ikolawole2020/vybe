import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { useComposerInset } from '@/lib/useComposerInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Avatar, Icon, Touchable, VText, haptic } from '@/components/ui';
import { VoiceRecorder } from '@/components/ui/VoiceRecorder';
import { VoiceNotePlayer } from '@/components/ui/VoiceNotePlayer';
import { TypingIndicator } from '@/components/ui/TypingIndicator';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { fmtAge } from '@/algo/engine';
import { fetchLastSeen, fetchProfilesByIds, fetchRemoteMessages } from '@/services/db';
import { subscribeToChatActivity, type ChatActivity } from '@/services/realtime';
import { useAuthor, useVybe } from '@/store/useVybe';
import { useAuth } from '@/store/useAuth';
import type { Author, DirectMessage, VoiceNote } from '@/data/types';

/** Shared, frozen, and referentially stable. See the selector below. */
const EMPTY_MESSAGES: DirectMessage[] = [];

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const composerPad = useComposerInset(space.sm);
  const { c } = useTheme();

  const myId = useAuth((s) => s.user?.id) ?? 'me';
  const conversation = useVybe((s) => s.conversations.find((conv) => conv.id === id));
  const messages = useVybe((s) => s.messages[id ?? ''] ?? EMPTY_MESSAGES);
  const sendMessage = useVybe((s) => s.sendMessage);
  const markConversationRead = useVybe((s) => s.markConversationRead);
  const circles = useVybe((s) => s.circles);
  const posts = useVybe((s) => s.posts);

  const participantId = conversation?.participantIds[0] ?? '';
  const author = useAuthor(participantId);
  const memberCircle = circles.find((cc) => cc.memberIds.includes(participantId));

  const [input, setInput] = useState('');
  const [otherActivity, setOtherActivity] = useState<ChatActivity>(null);
  const [otherIsHere, setOtherIsHere] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const listRef = useRef<FlatList>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendActivityRef = useRef<((activity: ChatActivity) => void) | null>(null);

  // Realtime activity broadcast + presence for this conversation
  useEffect(() => {
    if (!id || !myId) return;
    const { sendActivity, unsubscribe } = subscribeToChatActivity(id, myId, {
      onActivity: (payload) => {
        setOtherActivity(payload.activity);

        if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
        if (payload.activity) {
          activityTimeoutRef.current = setTimeout(() => setOtherActivity(null), 6000);
          setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        }
      },
      onPresence: (userIds) => setOtherIsHere(userIds.some((uid) => uid !== myId)),
    });
    sendActivityRef.current = sendActivity;

    return () => {
      sendActivity(null);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
      unsubscribe();
    };
  }, [id, myId]);

  useEffect(() => {
    const them = author?.id;
    if (!them || otherIsHere) return;
    let live = true;
    void fetchLastSeen([them]).then((map) => {
      if (live) setLastSeen(map[them] ?? null);
    });
    return () => {
      live = false;
    };
  }, [author?.id, otherIsHere]);

  const handleInputChange = (text: string) => {
    setInput(text);
    if (!sendActivityRef.current) return;

    if (text.length > 0) {
      sendActivityRef.current('typing');
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        sendActivityRef.current?.(null);
      }, 2500);
    } else {
      sendActivityRef.current(null);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    }
  };

  const handleRecordingChange = (recording: boolean) => {
    if (recording && typingTimerRef.current) clearTimeout(typingTimerRef.current);
    sendActivityRef.current?.(recording ? 'recording' : null);
  };

  useEffect(() => {
    if (!id) return;

    const load = () => {
      void fetchRemoteMessages(id).then((remote) => {
        if (remote.length === 0) return;
        useVybe.setState((s) => {
          const known = new Set(remote.map((m) => m.id));
          const inFlight = (s.messages[id] ?? []).filter((m) => m.pending && !known.has(m.id));
          return {
            messages: {
              ...s.messages,
              [id]: [...remote, ...inFlight].sort((a, b) => a.createdAt - b.createdAt),
            },
          };
        });
      });
    };

    load();
    markConversationRead(id);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        load();
        markConversationRead(id);
      }
    });
    return () => sub.remove();
  }, [id, markConversationRead]);

  useEffect(() => {
    if (participantId && !author) {
      void fetchProfilesByIds([participantId]).then((fetchedList) => {
        const found = fetchedList.find((a) => a.id === participantId);
        if (found) {
          useVybe.setState((s) => ({
            authors: {
              ...s.authors,
              [participantId]: found,
            },
          }));
        }
      });
    }
  }, [participantId, author]);

  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  const handleSend = () => {
    if (!input.trim() || !id) return;
    haptic('success');
    sendActivityRef.current?.(null);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    sendMessage(id, input.trim());
    setInput('');
    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);
  };

  const handlePickPhoto = async () => {
    if (!id) return;
    haptic('light');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: false,
      quality: 0.85,
    });

    const asset = res.assets?.[0];
    if (res.canceled || !asset?.uri) return;

    haptic('success');
    (sendMessage as (...args: any[]) => void)(id, '', undefined, undefined, asset.uri);
    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);
  };

  const handleSendVoiceNote = (vn: VoiceNote) => {
    if (!id) return;
    haptic('success');
    sendActivityRef.current?.(null);
    sendMessage(id, 'Voice message', vn);
    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.container, { backgroundColor: c.bg }]}>
      {/* Masthead */}
      <View style={[styles.header, { paddingTop: insets.top + space.sm, borderColor: c.border }]}>
        <Touchable
          onPress={() => goBack()}
          feedback="light"
          hitSlop={10}
          style={styles.backBtn}
        >
          <Icon name="chevron-left" size={24} color={c.text} />
        </Touchable>

        <Touchable
          onPress={() => participantId && router.push(`/profile-view/${participantId}`)}
          feedback="light"
          style={styles.headerProfile}
        >
          <View>
            <Avatar uri={author?.avatar ?? ''} size={36} ring={memberCircle?.color} />
            {otherIsHere ? (
              <View style={[styles.presenceDot, { backgroundColor: c.cyan, borderColor: c.bg }]} />
            ) : null}
          </View>
          <View>
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
            {otherIsHere ? (
              <VText variant="micro" color={c.cyan}>
                Online
              </VText>
            ) : lastSeen ? (
              <VText variant="micro" muted>
                {lastSeenLabel(lastSeen)}
              </VText>
            ) : (
              <VText variant="micro" muted>
                @{author?.handle ?? 'user'}
              </VText>
            )}
          </View>
        </Touchable>

        <View style={{ width: 36 }} />
      </View>

      <View style={[styles.retentionNote, { borderColor: c.border }]}>
        <Icon name="clock" size={12} color={c.textMuted} />
        <VText variant="micro" muted>
          Messages disappear after 7 days
        </VText>
      </View>

      <FlatList
        ref={listRef}
        data={ordered}
        inverted
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messageList}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={11}
        renderItem={({ item }) => (
          <MessageBubble message={item} isMine={item.senderId === myId} />
        )}
        ListHeaderComponent={
          otherActivity ? (
            <TypingIndicator
              kind={otherActivity}
              userName={author?.name}
              userAvatar={author?.avatar}
            />
          ) : null
        }
      />

      {/* Bottom Composer */}
      <View
        style={[
          styles.composerWrap,
          { paddingBottom: composerPad, borderColor: c.border, backgroundColor: c.bg },
        ]}
      >
        <View style={styles.composerRow}>
          <Touchable
            onPress={handlePickPhoto}
            feedback="light"
            hitSlop={8}
            scaleTo={0.9}
            style={[styles.actionBtn, { backgroundColor: c.surfaceElevated }]}
            accessibilityLabel="Send a photo"
          >
            <Icon name="image" size={20} color={c.primary} />
          </Touchable>

          <VoiceRecorder
            onSendVoiceNote={handleSendVoiceNote}
            onRecordingChange={handleRecordingChange}
          />

          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: c.surfaceElevated,
                color: c.text,
                borderColor: c.border,
              },
            ]}
            placeholder="Send a message..."
            placeholderTextColor={c.textMuted}
            value={input}
            onChangeText={handleInputChange}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />

          <Touchable
            onPress={handleSend}
            disabled={!input.trim()}
            feedback="select"
            scaleTo={0.9}
            style={[
              styles.sendBtn,
              { backgroundColor: input.trim() ? c.volt : c.surfaceElevated },
            ]}
          >
            <Icon
              name="send"
              size={18}
              color={input.trim() ? c.onVolt : c.textMuted}
            />
          </Touchable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function lastSeenLabel(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (mins < 2) return 'last seen just now';
  if (mins < 60) return `last seen ${mins}m ago`;

  const hours = Math.round(mins / 60);
  if (hours < 24) return `last seen ${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'last seen yesterday';
  if (days < 7) return `last seen ${days}d ago`;
  return 'last seen a while ago';
}

function MessageBubble({ message, isMine }: { message: DirectMessage; isMine: boolean }) {
  const { c } = useTheme();
  const router = useRouter();
  const sharedPost = useVybe((s) => s.posts.find((p) => p.id === message.sharedPostId));

  const imageUri =
    (message as any).media ||
    (message as any).mediaUrl ||
    (message as any).media_url ||
    (message as any).imageUrl ||
    (message as any).image;

  return (
    <View
      style={[
        styles.bubbleRow,
        { justifyContent: isMine ? 'flex-end' : 'flex-start' },
      ]}
    >
      <View
        style={[
          styles.bubble,
          isMine
            ? [styles.myBubble, { backgroundColor: c.volt }]
            : [styles.theirBubble, { backgroundColor: c.surfaceElevated, borderColor: c.border }],
        ]}
      >
        {/* Shared Post Preview if attached */}
        {sharedPost ? (
          <Touchable
            onPress={() => router.push(`/post/${sharedPost.id}`)}
            feedback="light"
            style={[styles.sharedCard, { backgroundColor: isMine ? 'rgba(0,0,0,0.12)' : c.bgSubtle }]}
          >
            {sharedPost.media && sharedPost.media.length > 0 ? (
              <Image source={{ uri: sharedPost.media[0] }} style={styles.sharedImage} contentFit="cover" />
            ) : null}
            <VText
              variant="micro"
              color={isMine ? c.onVolt : c.text}
              numberOfLines={2}
              style={{ fontWeight: '500' }}
            >
              {sharedPost.body || 'View shared post'}
            </VText>
          </Touchable>
        ) : null}

        {/* Media Image if attached */}
        {Boolean(imageUri) ? (
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: imageUri }}
              style={styles.bubbleImage}
              contentFit="cover"
              transition={150}
            />
          </View>
        ) : null}

        {/* Voice Note if attached */}
        {message.voiceNote ? (
          <View style={{ width: 220, marginVertical: 4 }}>
            <VoiceNotePlayer voiceNote={message.voiceNote} compact />
          </View>
        ) : null}

        {message.body && (!sharedPost || message.body !== 'Shared a post with you') ? (
          <VText
            variant="body"
            color={isMine ? c.onVolt : c.text}
            style={{ fontWeight: isMine ? '500' : '400' }}
          >
            {message.body}
          </VText>
        ) : null}

        <View style={[styles.metaRow, { alignSelf: isMine ? 'flex-end' : 'flex-start' }]}>
          <VText
            variant="micro"
            color={message.failed ? c.ember : isMine ? 'rgba(0,0,0,0.5)' : c.textMuted}
            style={styles.time}
          >
            {message.failed
              ? 'Not delivered'
              : fmtAge((Date.now() - message.createdAt) / 3600_000)}
          </VText>
          {message.pending ? (
            <ActivityIndicator size="small" color={isMine ? 'rgba(0,0,0,0.4)' : c.textMuted} />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.base,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    minHeight: 40,
    justifyContent: 'center',
  },
  headerProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presenceDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  circleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
  retentionNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  messageList: {
    paddingHorizontal: space.base,
    paddingTop: space.md,
    paddingBottom: space.md,
    gap: space.sm,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 2,
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: space.base,
    paddingVertical: space.sm,
    borderRadius: radius.xl,
    gap: 4,
  },
  myBubble: {
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  time: {
    fontSize: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  sharedCard: {
    padding: space.sm,
    borderRadius: radius.md,
    gap: 6,
    marginBottom: 4,
  },
  sharedImage: {
    width: '100%',
    height: 120,
    borderRadius: radius.sm,
  },
  imageContainer: {
    borderRadius: radius.md,
    overflow: 'hidden',
    marginTop: 2,
    marginBottom: 2,
  },
  bubbleImage: {
    width: 220,
    height: 180,
    borderRadius: radius.md,
  },
  composerWrap: {
    paddingHorizontal: space.base,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  actionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    height: 42,
    borderRadius: radius.pill,
    paddingHorizontal: space.base,
    fontSize: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});