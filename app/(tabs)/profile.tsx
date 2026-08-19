import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeIn, LinearTransition, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { TopScrim } from '@/components/TopScrim';
import { Avatar, Icon, Touchable, VText, haptic } from '@/components/ui';
import { FollowListModal } from '@/components/ui/FollowListModal';
import { PostCard } from '@/components/feed/PostCard';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, rule, space, spring } from '@/theme/tokens';
import { TAB_BAR_CLEARANCE } from '@/components/nav/LiquidTabBar';
import {
  countFollowers,
  countFollowing,
  fetchPostsByAuthor,
  fetchPostsByIds,
  fetchProfilesByIds,
  uploadImage,
} from '@/services/db';
import { useAuth } from '@/store/useAuth';
import { fmtAge, fmtCount } from '@/algo/engine';
import { isEarlyAdopter, useAuthor, useVybe } from '@/store/useVybe';
import type { Draft, Post } from '@/data/types';

type Tab = 'posts' | 'liked' | 'saved' | 'drafts';

const TABS: { id: Tab; label: string }[] = [
  { id: 'posts', label: 'Posts' },
  { id: 'liked', label: 'Liked' },
  { id: 'saved', label: 'Saved' },
  { id: 'drafts', label: 'Drafts' },
];

export default function ProfileScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const posts = useVybe((s) => s.posts);
  const liked = useVybe((s) => s.liked);
  const saved = useVybe((s) => s.saved);
  const drafts = useVybe((s) => s.drafts);
  const circles = useVybe((s) => s.circles);
  const profile = useVybe((s) => s.profile);
  const setProfile = useVybe((s) => s.setProfile);
  const cacheAuthors = useVybe((s) => s.cacheAuthors);

  const [tab, setTab] = useState<Tab>('posts');
  const [fetched, setFetched] = useState<Record<string, Post>>({});

  const byId = useMemo(
    () => ({ ...fetched, ...Object.fromEntries(posts.map((p) => [p.id, p])) }),
    [posts, fetched],
  );

  useEffect(() => {
    const wanted = [...new Set([...liked, ...saved])].filter((id) => !byId[id]);
    if (!wanted.length) return;
    let live = true;
    void fetchPostsByIds(wanted).then((found) => {
      if (!live || !found.length) return;
      setFetched((prev) => ({ ...prev, ...Object.fromEntries(found.map((p) => [p.id, p])) }));
      void fetchProfilesByIds([...new Set(found.map((p) => p.authorId))]).then((people) => {
        if (live) cacheAuthors(people);
      });
    });
    return () => {
      live = false;
    };
  }, [liked, saved, byId, cacheAuthors]);

  const likedPosts = useMemo(
    () => liked.map((id) => byId[id]).filter(Boolean) as Post[],
    [liked, byId],
  );
  const savedPosts = useMemo(
    () => saved.map((id) => byId[id]).filter(Boolean) as Post[],
    [saved, byId],
  );

  const early = isEarlyAdopter(profile);

  const myStory = useVybe((s) =>
    s.profile.id ? s.stories.find((st) => st.authorId === s.profile.id) : undefined,
  );
  const hasStory = Boolean(myStory && myStory.items.length > 0);
  const openMyStory = () => {
    haptic('light');
    if (myStory) router.push(`/story/${myStory.authorId}` as any);
  };

  const pickAvatar = async () => {
    haptic('light');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (res.canceled) return;

    const uid = useAuth.getState().user?.id;
    if (!uid) return;
    const url = await uploadImage('avatars', uid, res.assets[0].uri);
    if (!url) return;
    void setProfile({ avatar: url });
    haptic('success');
  };

  const [mine, setMine] = useState<Post[]>([]);
  const [followers, setFollowers] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followModalVisible, setFollowModalVisible] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<'followers' | 'following'>('followers');

  useEffect(() => {
    if (!profile.id) return;
    let live = true;
    void fetchPostsByAuthor(profile.id).then((found) => {
      if (live) setMine(found);
    });
    void countFollowers(profile.id).then((n) => {
      if (live) setFollowers(n);
    });
    void countFollowing(profile.id).then((n) => {
      if (live) setFollowingCount(n);
    });
    return () => {
      live = false;
    };
  }, [profile.id, posts]);

  const counts: Record<Tab, number> = {
    posts: mine.length,
    liked: likedPosts.length,
    saved: savedPosts.length,
    drafts: drafts.length,
  };

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + space.xxl,
          gap: space.lg,
        }}
      >
        <View style={{ paddingHorizontal: space.gutter }}>
          <View style={styles.headerBlock}>
            <View style={styles.identity}>
              <Touchable
                onPress={hasStory ? openMyStory : pickAvatar}
                feedback="light"
                accessibilityLabel={
                  hasStory ? 'Watch your story' : 'Change your profile picture'
                }
                style={styles.avatarWrap}
              >
                <Avatar uri={profile.avatar} size={72} ring={hasStory ? c.volt : undefined} />
                <View style={[styles.camera, { backgroundColor: c.volt, borderColor: c.bg }]}>
                  <Icon name={hasStory ? 'play' : 'camera'} size={12} color={c.onVolt} />
                </View>
              </Touchable>

              <View style={styles.identityMeta}>
                <Touchable
                  onPress={() => router.push('/edit-profile')}
                  feedback="light"
                  scaleTo={1}
                  accessibilityLabel="Edit your name and nickname"
                  style={styles.nameBlock}
                >
                  <View style={styles.nameRow}>
                    <VText variant="heading" numberOfLines={1} style={styles.nameText}>
                      {profile.name || 'You'}
                    </VText>
                    {early ? (
                      <View style={styles.badge}>
                        <VerifiedBadge size={16} />
                      </View>
                    ) : null}
                  </View>
                  <VText variant="caption" muted numberOfLines={1} style={styles.handleText}>
                    @{profile.handle || 'handle'}
                  </VText>
                </Touchable>
              </View>

              <Touchable
                onPress={() => router.push('/settings')}
                feedback="light"
                hitSlop={10}
                accessibilityLabel="Settings"
                style={[styles.gear, { borderColor: c.border }]}
              >
                <Icon name="settings" size={18} color={c.text} />
              </Touchable>
            </View>

            {profile.bio ? (
              <VText variant="callout" secondary style={styles.bio}>
                {profile.bio}
              </VText>
            ) : null}

            <View style={styles.stats}>
              <Stat label="Posts" value={String(mine.length)} />
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
                <Stat label="Followers" value={fmtCount(followers)} />
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
                <Stat label="Following" value={fmtCount(followingCount)} />
              </Touchable>
              <Stat label="Circles" value={String(circles.length)} />
            </View>
          </View>
        </View>

        <View>
          <Switcher tab={tab} counts={counts} onChange={setTab} />
        </View>

        <Animated.View entering={FadeIn.duration(200)} style={{ gap: space.sm }}>
          {tab === 'posts' ? (
            mine.length ? (
              <View style={styles.postsList}>
                {mine.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </View>
            ) : (
              <Empty
                glyph="edit-3"
                text="You have not posted yet. Anything you write shows up here."
              />
            )
          ) : null}

          {tab === 'drafts' ? (
            drafts.length ? (
              drafts.map((d) => <DraftRow key={d.id} draft={d} />)
            ) : (
              <Empty
                glyph="edit-3"
                text="No drafts. Anything you start writing and close is kept here."
              />
            )
          ) : null}

          {tab === 'liked' ? (
            likedPosts.length ? (
              likedPosts.map((p) => <PostRow key={p.id} post={p} />)
            ) : (
              <Empty glyph="heart" text="Nothing liked yet. Posts you like collect here." />
            )
          ) : null}

          {tab === 'saved' ? (
            savedPosts.length ? (
              savedPosts.map((p) => <PostRow key={p.id} post={p} />)
            ) : (
              <Empty glyph="bookmark" text="Nothing saved yet. Save a post to keep it here." />
            )
          ) : null}
        </Animated.View>
      </ScrollView>
      <TopScrim />

      <FollowListModal
        visible={followModalVisible}
        userId={profile.id}
        userName={profile.name || 'Your Network'}
        initialTab={followModalTab}
        onClose={() => setFollowModalVisible(false)}
      />
    </View>
  );
}

function Switcher({
  tab,
  counts,
  onChange,
}: {
  tab: Tab;
  counts: Record<Tab, number>;
  onChange: (t: Tab) => void;
}) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const index = TABS.findIndex((t) => t.id === tab);
  const seg = w > 0 ? w / TABS.length : 0;

  const thumb = useAnimatedStyle(() => ({
    width: seg,
    transform: [{ translateX: withSpring(index * seg, spring.snappy) }],
  }));

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={styles.switcher}>
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Touchable
              key={t.id}
              onPress={() => {
                haptic('select');
                onChange(t.id);
              }}
              feedback="none"
              scaleTo={1}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${t.label}, ${counts[t.id]}`}
              style={styles.switchBtn}
            >
              <VText variant={on ? 'bodyMedium' : 'body'} color={on ? c.text : c.textMuted}>
                {t.label}
              </VText>
              {counts[t.id] ? (
                <VText variant="micro" muted>
                  {counts[t.id]}
                </VText>
              ) : null}
            </Touchable>
          );
        })}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
      {seg > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { backgroundColor: c.volt }, thumb]}
        />
      ) : null}
    </View>
  );
}

function PostRow({ post }: { post: Post }) {
  const { c } = useTheme();
  const router = useRouter();
  const author = useAuthor(post.authorId);

  return (
    <Touchable
      onPress={() => router.push(`/post/${post.id}`)}
      feedback="light"
      scaleTo={0.99}
      accessibilityLabel={`Post by ${author?.name ?? 'someone'}`}
      style={[styles.row, { borderColor: c.border }]}
    >
      {post.media[0] ? (
        <Image source={{ uri: post.media[0] }} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbBlank, { backgroundColor: c.surfaceElevated }]}>
          <Icon name="align-left" size={18} color={c.textMuted} />
        </View>
      )}

      <View style={{ flex: 1, gap: 4 }}>
        <VText variant="caption" muted numberOfLines={1}>
          {author?.name ?? 'Someone'} · {fmtAge((Date.now() - post.createdAt) / 3600_000)} ago
        </VText>
        <VText variant="body" numberOfLines={2}>
          {post.body}
        </VText>
      </View>
    </Touchable>
  );
}

function DraftRow({ draft }: { draft: Draft }) {
  const { c } = useTheme();
  const router = useRouter();
  const removeDraft = useVybe((s) => s.removeDraft);

  return (
    <Animated.View layout={LinearTransition}>
      <Touchable
        onPress={() => router.push(`/compose?draft=${draft.id}`)}
        feedback="light"
        scaleTo={0.99}
        accessibilityLabel="Open draft"
        style={[styles.row, { borderColor: c.border }]}
      >
        {draft.media[0] ? (
          <Image source={{ uri: draft.media[0] }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbBlank, { backgroundColor: c.surfaceElevated }]}>
            <Icon name={draft.poll ? 'bar-chart-2' : 'edit-3'} size={18} color={c.textMuted} />
          </View>
        )}

        <View style={{ flex: 1, gap: 4 }}>
          <VText variant="caption" muted>
            Saved {fmtAge((Date.now() - draft.savedAt) / 3600_000)} ago
          </VText>
          <VText variant="body" numberOfLines={2}>
            {draft.body ||
              draft.poll?.question ||
              (draft.media.length ? 'Photos only, no words yet.' : 'Nothing written yet.')}
          </VText>
        </View>

        <Touchable
          onPress={() => {
            haptic('warning');
            removeDraft(draft.id);
          }}
          feedback="light"
          hitSlop={10}
          accessibilityLabel="Delete draft"
        >
          <Icon name="trash-2" size={17} color={c.textMuted} />
        </Touchable>
      </Touchable>
    </Animated.View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <VText variant="heading">{value}</VText>
      <VText variant="micro" muted>
        {label}
      </VText>
    </View>
  );
}

function Empty({
  glyph,
  text,
}: {
  glyph: React.ComponentProps<typeof Icon>['name'];
  text: string;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.empty}>
      <Icon name={glyph} size={26} color={c.textMuted} />
      <VText variant="caption" muted style={{ textAlign: 'center', maxWidth: 260 }}>
        {text}
      </VText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBlock: {
    gap: space.md,
    paddingBottom: space.sm,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarWrap: {
    position: 'relative',
    marginRight: space.md,
    flexShrink: 0,
  },
  identityMeta: {
    flex: 1,
    minWidth: 0,
    marginRight: space.sm,
    justifyContent: 'center',
  },
  nameBlock: {
    alignSelf: 'stretch',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    maxWidth: '100%',
  },
  nameText: {
    flexShrink: 1,
    minWidth: 0,
  },
  badge: {
    marginLeft: 6,
    flexShrink: 0,
  },
  handleText: {
    marginTop: 2,
  },
  bio: {
    marginTop: 2,
  },
  gear: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingTop: space.xs,
    paddingRight: space.sm,
  },
  camera: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postsList: {
    marginTop: space.md,
  },

  switcher: { flexDirection: 'row' },
  indicator: { position: 'absolute', bottom: 0, height: rule.medium },
  switchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    minHeight: 44,
  },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  thumbBlank: { alignItems: 'center', justifyContent: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    marginHorizontal: space.gutter,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl },
});