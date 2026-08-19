import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { useComposerInset } from '@/lib/useComposerInset';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { PostCard } from '@/components/feed/PostCard';
import { Avatar, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';
import { TOPIC_BY_ID } from '@/data/topics';
import { createReply, fetchPostsByIds, fetchProfilesByIds, fetchReplies } from '@/services/db';
import { useAuth } from '@/store/useAuth';
import type { Post, Reply, VoiceNote } from '@/data/types';
import { fmtAge, parseDearAlgo, rankFeed } from '@/algo/engine';
import { useAuthor, useVybe } from '@/store/useVybe';
import { VoiceNotePlayer } from '@/components/ui/VoiceNotePlayer';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const composerPad = useComposerInset(space.md);
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();

  const posts = useVybe((s) => s.posts);
  const myAvatar = useVybe((s) => s.profile.avatar);
  const algo = useVybe((s) => s.algo);
  const circles = useVybe((s) => s.circles);
  const setTopicWeight = useVybe((s) => s.setTopicWeight);
  const nudgeAuthor = useVybe((s) => s.nudgeAuthor);
  const addMode = useVybe((s) => s.addMode);

  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState<string | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [sending, setSending] = useState(false);

  const cacheAuthors = useVybe((s) => s.cacheAuthors);

  useEffect(() => {
    if (!id) return;
    let live = true;
    void fetchReplies(id).then((r) => {
      if (!live) return;
      setReplies(r.replies);
      cacheAuthors(r.authors);
    });
    return () => {
      live = false;
    };
  }, [id, cacheAuthors]);

  const authors = useVybe((s) => s.authors);
  const viewerId = useVybe((s) => s.profile.id);

  /**
   * A post you opened may not be in the feed window.
   *
   * The window is the recent slice the feed ranks; anything you saved or liked
   * a while ago, and anything reached from a link, is outside it. Resolving the
   * screen against the window alone meant those all landed on "Post not found".
   */
  const inWindow = posts.some((p) => p.id === id);
  const [fetchedPost, setFetchedPost] = useState<Post | null>(null);

  useEffect(() => {
    if (!id || inWindow || fetchedPost) return;
    let live = true;
    void fetchPostsByIds([id]).then((found) => {
      if (!live || !found[0]) return;
      setFetchedPost(found[0]);
      void fetchProfilesByIds([found[0].authorId]).then((people) => {
        if (live) cacheAuthors(people);
      });
    });
    return () => {
      live = false;
    };
  }, [id, inWindow, fetchedPost, cacheAuthors]);

  const pool = useMemo(
    () => (inWindow || !fetchedPost ? posts : [...posts, fetchedPost]),
    [posts, inWindow, fetchedPost],
  );

  const ranked = useMemo(
    () => rankFeed({ posts: pool, state: algo, circles, authors, viewerId, mode: 'for-you' }),
    [pool, algo, circles, authors, viewerId],
  );
  const entry = ranked.find((r) => r.post.id === id);
  const post = entry?.post;

  /**
   * Mirrors `can_reply_to_post()` in the database, which is the thing that
   * actually decides. Notably the author can always answer their own post,
   * whatever they set the policy to — without that line, limiting replies to a
   * circle locks you out of your own thread.
   */
  const canInteract =
    post?.authorId === viewerId ||
    post?.boundary.canInteract.includes('public') ||
    post?.boundary.canInteract.some((cc) => circles.some((x) => x.id === cc));


  const send = async () => {
    const text = draft.trim();
    const uid = useAuth.getState().user?.id;
    if (!text || !post || !uid || sending) return;

    setSending(true);
    const res = await createReply(post.id, uid, text);
    setSending(false);

    if (!res.ok) {
      setApplied(res.message);
      setTimeout(() => setApplied(null), 4500);
      return;
    }

    setReplies((prev) => [...prev, res.reply]);
    setDraft('');
    haptic('success');

    // A reply that happens to address the algorithm also retunes it. That is
    // the one thing `@my_algo` ever did, and it now happens on top of an
    // ordinary reply rather than instead of one.
    const parsed = parseDearAlgo(text, post.topics);

    if (parsed) {
      // "Dear Algo" — a public, ordinary-looking reply that also retrains the feed.
      const magnitude = 0.25 * parsed.direction;
      let what = 'this account';
      if (parsed.topicId) {
        const topic = TOPIC_BY_ID[parsed.topicId];
        what = topic?.label ?? parsed.topicId;
        if (parsed.days) {
          addMode({
            label: `${parsed.direction > 0 ? 'More' : 'Less'} ${what}`,
            topicId: parsed.topicId,
            delta: 0.6 * parsed.direction,
            expiresAt: Date.now() + parsed.days * 86_400_000,
          });
        } else {
          const current = algo.topicWeights[parsed.topicId] ?? 0;
          setTopicWeight(parsed.topicId, current + magnitude * 2, 'dear-algo');
        }
      } else {
        nudgeAuthor(post.authorId, magnitude, 'dear-algo');
      }

      setApplied(
        `${parsed.direction > 0 ? 'Turned up' : 'Turned down'} ${what}` +
          (parsed.days ? ` for ${parsed.days} days` : ''),
      );
      setTimeout(() => setApplied(null), 4500);
    }
  };

  /**
   * This subscription sat *below* the `if (!post) return` guard, which is a
   * conditional hook call and a genuine crash rather than a lint complaint.
   *
   * Opening a post that is not in the feed window — anything reached from a
   * link, or an older item from Liked or Saved — renders once with no post
   * (eleven hooks, early return), then the fetch lands and it renders again
   * *with* one (twelve hooks). React compares the two and throws "Rendered more
   * hooks than during the previous render", and the screen white-screens. Moved
   * above every return, where a hook has to be.
   */
  const removePost = useVybe((s) => s.removePost);

  const handleDeletePost = () => {
    if (!post) return;
    haptic('warning');
    Alert.alert(
      'Delete Post',
      'Are you sure you want to permanently delete this post? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptic('success');
            void removePost(post.id);
            goBack();
          },
        },
      ]
    );
  };

  if (!post || !entry) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <VText muted>Post not found.</VText>
      </View>
    );
  }

  const isOwnPost = post.authorId === viewerId;

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura intensity={0.7} />
      {/*
        Anchored at the top of the screen and avoiding with padding, so the
        replies list shrinks and carries the reply box up with it. See the long
        note in `app/messages/[id].tsx` — the `KeyboardStickyView` this replaces
        slid the box over the replies instead of making room for it, and on
        Android it did not move at all.
      */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View style={[styles.bar, { paddingTop: insets.top + space.sm, borderBottomColor: c.divider }]}>
          <Touchable onPress={() => goBack()} feedback="light" hitSlop={10} accessibilityLabel="Back">
            <Icon name="chevron-left" size={24} color={c.text} />
          </Touchable>
          <VText variant="subheading">Post</VText>
          {isOwnPost ? (
            <Touchable onPress={handleDeletePost} feedback="light" hitSlop={10} accessibilityLabel="Delete Post">
              <Icon name="trash-2" size={19} color="#FF453A" />
            </Touchable>
          ) : (
            <View style={{ width: 24 }} />
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          // `140` before, which was clearance for a composer that floated over
          // this list. It sits in the layout now and takes its own space, so
          // that much trailing padding is just a screenful of nothing under the
          // last reply — most of what you would see once the keyboard shortens
          // the list.
          contentContainerStyle={{ padding: space.base, gap: space.base, paddingBottom: space.xl }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Full-bleed: the row carries its own gutter. */}
          <View style={{ marginHorizontal: -space.base }}>
            <PostCard post={post} receipt={entry.receipt} detail />
          </View>

          {/* Replies are rows on the same left edge as the post above them,
              so a thread reads as one column rather than as a card followed by
              a list of other cards. */}
          <View style={{ marginHorizontal: -space.base }}>
            {replies.map((r) => (
              <ReplyRow key={r.id} reply={r} />
            ))}
          </View>

          {!replies.length ? (
            <VText variant="caption" muted style={{ paddingTop: space.md }}>
              No replies yet. Be the first.
            </VText>
          ) : null}
        </ScrollView>

        {applied ? (
          <Animated.View
            entering={FadeInDown}
            style={[styles.toast, { bottom: insets.bottom + 92, backgroundColor: c.accent }]}
          >
            <Icon name="check" size={15} color={c.onAccent} />
            <VText variant="label" color={c.onAccent}>
              {applied}
            </VText>
          </Animated.View>
        ) : null}

        <View
          style={[
            styles.composer,
            {
              paddingBottom: composerPad,
              backgroundColor: c.surface,
              borderTopColor: c.divider,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          {!canInteract ? (
            <View style={styles.locked}>
              <Icon name="lock" size={14} color={c.textMuted} />
              <VText variant="caption" muted style={{ flex: 1 }}>
                The author limited replies to a Circle you are not in. You can still read and boost.
              </VText>
            </View>
          ) : (
            <>
              <View style={styles.inputRow}>
                {/* Your own face on the composer, so the reply row you are
                    about to create is visibly the row you are typing into. */}
                <Avatar uri={myAvatar} size={34} />
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Post your reply"
                  placeholderTextColor={c.textMuted}
                  style={[
                    type.callout,
                    styles.input,
                    { color: c.text, backgroundColor: c.bgSubtle, borderColor: c.border },
                  ]}
                  multiline
                  accessibilityLabel="Reply text"
                  /*
                    Making room for the keyboard is not the same as showing the
                    right thing in the room that is left.

                    The list shortens correctly now, but it keeps whatever offset
                    it had — which on a post you have just opened is the top, so
                    you are looking at the picture while typing a reply to a
                    conversation you cannot see. Focusing the field means you are
                    about to join the end of that conversation, so the end is
                    what should be on screen.

                    Delayed a frame: the scroll has to happen after the keyboard
                    padding has shortened the view, or it scrolls to the end of
                    the taller layout and lands short.
                  */
                  onFocus={() => {
                    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
                  }}
                />
                <Touchable
                  onPress={send}
                  disabled={!draft.trim()}
                  feedback="medium"
                  accessibilityLabel="Send reply"
                  style={[
                    styles.send,
                    { backgroundColor: draft.trim() ? c.volt : c.surfaceElevated },
                  ]}
                >
                  <VText variant="label" color={draft.trim() ? c.onVolt : c.textMuted}>
                    Reply
                  </VText>
                </Touchable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * One reply.
 *
 * A component rather than inline markup purely so it can call `useAuthor` —
 * hooks cannot run inside a `.map()`, and reading the raw author map instead is
 * what made your own replies render as a stranger: you are not in that map,
 * your row lives in `profile`.
 */
function ReplyRow({ reply }: { reply: Reply }) {
  const { c } = useTheme();
  const router = useRouter();
  const who = useAuthor(reply.authorId);

  return (
    <Animated.View entering={FadeIn} style={[styles.comment, { borderBottomColor: c.divider }]}>
      <Touchable
        onPress={() => router.push(`/profile-view/${reply.authorId}`)}
        feedback="light"
        scaleTo={0.92}
        accessibilityLabel={who?.name ?? 'Profile'}
      >
        <Avatar uri={who?.avatar ?? ''} size={38} />
      </Touchable>

      <View style={{ flex: 1, gap: 4 }}>
        {/* Name, handle and age on one line, as in the post above — three
            separate lines of metadata above two lines of reply was more
            chrome than content. */}
        <Touchable
          onPress={() => router.push(`/profile-view/${reply.authorId}`)}
          feedback="none"
          scaleTo={1}
          style={styles.replyIdentity}
        >
          <VText variant="bodyMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
            {who?.name ?? 'Unknown'}
          </VText>
          <VText variant="micro" muted numberOfLines={1} style={{ flexShrink: 1 }}>
            @{who?.handle ?? 'user'}
          </VText>
          <VText variant="micro" muted>
            · {fmtAge((Date.now() - reply.createdAt) / 3600_000)}
          </VText>
        </Touchable>

        {reply.voiceNote ? (
          <View style={{ marginVertical: 2 }}>
            <VoiceNotePlayer voiceNote={reply.voiceNote} compact />
          </View>
        ) : null}

        {reply.body ? <VText variant="body">{reply.body}</VText> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.base,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  comment: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    paddingHorizontal: space.base,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  replyIdentity: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  composer: {
    paddingTop: space.md,
    paddingHorizontal: space.base,
    gap: space.sm,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 40,
    paddingHorizontal: space.base,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  voiceBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: {
    height: 40,
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
});
