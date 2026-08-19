import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { AmbientAura } from '@/components/AmbientAura';
import { TopScrim } from '@/components/TopScrim';
import { PostCard } from '@/components/feed/PostCard';
import { Avatar, Button, Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { FollowListModal } from '@/components/ui/FollowListModal';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, space } from '@/theme/tokens';
import { countFollowers, countFollowing, fetchPostsByAuthor, fetchProfilesByIds, recordRemoteProfileView } from '@/services/db';
import { fmtCount, rankFeed } from '@/algo/engine';
import { useAuthor, useVybe } from '@/store/useVybe';
import type { Post } from '@/data/types';

/** What "show me more of them" is worth. One step, not a dial. */
const MORE_FROM_THEM = 0.6;

export default function AuthorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const algo = useVybe((s) => s.algo);
  const circles = useVybe((s) => s.circles);
  const authors = useVybe((s) => s.authors);
  const viewerId = useVybe((s) => s.profile.id);
  const myProfile = useVybe((s) => s.profile);
  const toggleCircleMember = useVybe((s) => s.toggleCircleMember);
  const nudgeAuthor = useVybe((s) => s.nudgeAuthor);
  const cacheAuthors = useVybe((s) => s.cacheAuthors);
  const toggleFollow = useVybe((s) => s.toggleFollow);
  const isFollowing = useVybe((s) => (id ? s.following.includes(id) : false));
  /** `viewerId` is empty until the profile loads, so it has to be checked. */
  const isSelf = Boolean(viewerId) && id === viewerId;

  /**
   * Their story, if one is running and this viewer is allowed to see it.
   *
   * The ring sits on the volt hero plate, so it cannot be volt: unseen is drawn
   * in the plate's ink colour and already-watched in a dimmed version of it —
   * the same "bright means new" reading the tray uses, in the two colours this
   * surface actually has.
   */
  const theirStory = useVybe((s) =>
    s.stories.find(
      (st) =>
        st.authorId === id &&
        st.items.length > 0 &&
        !st.items.every((it) => it.hiddenUserIds?.includes(viewerId)),
    ),
  );
  const seenStoryItemIds = useVybe((s) => s.seenStoryItemIds);
  const storyUnseen = Boolean(
    theirStory?.items.some((it) => !it.seen && !seenStoryItemIds.includes(it.id)),
  );
  const startConversation = useVybe((s) => s.startConversation);

  const author = useAuthor(id);
  const weight = algo.authorWeights[id ?? ''] ?? 0;
  const boosted = weight > MORE_FROM_THEM / 2;

  const [theirPosts, setTheirPosts] = useState<Post[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followModalVisible, setFollowModalVisible] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<'followers' | 'following'>('followers');

  useEffect(() => {
    if (!id) return;
    let live = true;
    void fetchPostsByAuthor(id).then((found) => {
      if (live) setTheirPosts(found);
    });

    void countFollowers(id).then((n) => {
      if (live) setFollowerCount(n);
    });

    void countFollowing(id).then((n) => {
      if (live) setFollowingCount(n);
    });

    // Record profile view to Supabase for the target user (does not notify viewer's own phone)
    if (id !== viewerId && myProfile?.handle) {
      void recordRemoteProfileView(id, viewerId);
    }

    // Arriving here directly — from a deep link, or after a cold start — means
    // the profile may not be in the store yet.
    if (!author) {
      void fetchProfilesByIds([id]).then((found) => {
        if (live) cacheAuthors(found);
      });
    }
    return () => {
      live = false;
    };
  }, [id, author, cacheAuthors, viewerId, myProfile, isFollowing]);

  const theirs = useMemo(
    () => rankFeed({ posts: theirPosts, state: algo, circles, authors, viewerId, mode: 'for-you' }),
    [theirPosts, algo, circles, authors, viewerId],
  );

  if (!author) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <VText muted>No such account.</VText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura intensity={0.7} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.base,
          gap: space.lg,
        }}
      >
        <Touchable onPress={() => goBack()} feedback="light" hitSlop={10} accessibilityLabel="Back">
          <Icon name="chevron-left" size={24} color={c.text} />
        </Touchable>

        {/* Same volt plate the user's own profile uses — an account is an
            account, whoever is looking at it. */}
        <View style={[styles.hero, shadow.card, { backgroundColor: c.volt }]}>
          <View style={styles.head}>
            {/* A live story is worth showing on the page that is about the
                person: ring the avatar and let the tap play it, exactly as the
                tray does. With no story running, the tap opens the picture. */}
            <Touchable
              onPress={() => {
                if (theirStory) {
                  haptic('light');
                  router.push(`/story/${author.id}` as any);
                } else if (author.avatar) {
                  router.push({ pathname: '/photo/[id]', params: { id: 'avatar', uri: author.avatar } });
                }
              }}
              disabled={!author.avatar && !theirStory}
              feedback="light"
              scaleTo={0.94}
              accessibilityLabel={
                theirStory ? `Watch ${author.name}'s story` : `${author.name}'s profile picture`
              }
            >
              <Avatar
                uri={author.avatar}
                size={72}
                ring={theirStory ? (storyUnseen ? c.onVolt : 'rgba(18,22,10,0.35)') : undefined}
              />
            </Touchable>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <VText variant="title" color={c.onVolt}>
                  {author.name}
                </VText>
              </View>
              <VText variant="caption" color={c.onVolt} style={{ opacity: 0.65 }}>
                @{author.handle}
              </VText>
            </View>
          </View>

          {author.bio ? (
            <VText variant="callout" color={c.onVolt} style={{ opacity: 0.8 }}>
              {author.bio}
            </VText>
          ) : null}

          {/*
            Following and circles are different things and the screen should not
            blur them. A follow says "show me their posts at all"; a circle says
            "and count them this much". The Following feed mode has nothing to
            draw on without this.
          */}
          {/*
            Your own profile offers neither of these.
            
            Reaching this screen as yourself is easy — tap your own name on one
            of your posts — and it offered a Follow button for following
            yourself and a Message button for opening a chat with yourself.
            Both write real rows. What you want there is the profile you can
            actually edit, so that is what it offers instead.
          */}
          <View style={styles.actionRow}>
            {isSelf ? (
              <Button
                label="Edit profile"
                glyph="edit-3"
                variant="ghost"
                onPress={() => {
                  haptic('light');
                  router.push('/edit-profile');
                }}
              />
            ) : (
            <Button
              label={isFollowing ? 'Following' : 'Follow'}
              glyph={isFollowing ? 'check' : 'plus'}
              variant={isFollowing ? 'ghost' : 'primary'}
              onPress={() => {
                haptic(isFollowing ? 'light' : 'success');
                toggleFollow(author.id);
              }}
            />
            )}
            {isSelf ? null : (
            <Button
              label="Message"
              glyph="message-circle"
              variant="ghost"
              onPress={() => {
                haptic('light');
                // Navigate only once the server has confirmed the thread id.
                // Pushing an optimistic id opened the chat screen on a
                // conversation that was renamed underneath it a moment later
                // and sat there permanently empty.
                void startConversation(author.id).then((convId) => {
                  if (convId) router.push(`/messages/${convId}` as any);
                });
              }}
            />
            )}
          </View>

          <View style={styles.stats}>
            <Touchable
              onPress={() => {
                haptic('light');
                setFollowModalTab('followers');
                setFollowModalVisible(true);
              }}
              feedback="select"
              scaleTo={0.92}
              accessibilityLabel="View Followers"
            >
              <HeroFigure label="Followers" value={fmtCount(followerCount)} />
            </Touchable>
            <Touchable
              onPress={() => {
                haptic('light');
                setFollowModalTab('following');
                setFollowModalVisible(true);
              }}
              feedback="select"
              scaleTo={0.92}
              accessibilityLabel="View Following"
            >
              <HeroFigure label="Following" value={fmtCount(followingCount)} />
            </Touchable>
            <HeroFigure label="Posts" value={String(theirs.length)} />
          </View>
        </View>

        <View style={{ gap: space.sm }}>
          <VText variant="label" secondary>
            Put them in a Circle
          </VText>
          <View style={styles.chips}>
            {circles.map((cc) => (
              <Chip
                key={cc.id}
                label={cc.name}
                tone={cc.color}
                active={cc.memberIds.includes(author.id)}
                onPress={() => toggleCircleMember(cc.id, author.id)}
              />
            ))}
            {!circles.length ? (
              <Chip label="Make a circle" glyph="plus" onPress={() => router.push('/circles')} />
            ) : null}
          </View>
        </View>

        {boosted ? null : (
          <Button
            label="Show me more of them"
            glyph="trending-up"
            onPress={() => {
              haptic('success');
              nudgeAuthor(author.id, MORE_FROM_THEM - weight, 'panel');
            }}
          />
        )}

        {/* Post rows are full-bleed and carry their own gutter, so they reach
            back out through this screen's inset and stack with no gap. */}
        <View style={{ marginHorizontal: -space.base, gap: 0 }}>
          {theirs.map((r) => (
            <PostCard key={r.post.id} post={r.post} receipt={r.receipt} />
          ))}
        </View>
      </ScrollView>
      <TopScrim />

      <FollowListModal
        visible={followModalVisible}
        userId={author.id}
        userName={author.name}
        initialTab={followModalTab}
        onClose={() => setFollowModalVisible(false)}
      />
    </View>
  );
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 1 }}>
      <VText variant="heading" color={c.onVolt}>
        {value}
      </VText>
      <VText variant="micro" color={c.onVolt} style={{ opacity: 0.6 }}>
        {label}
      </VText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xxl, padding: space.lg, gap: space.base },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.base },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
