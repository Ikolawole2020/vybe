import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useRouter, usePathname } from 'expo-router';
import Animated, {
  FadeIn,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { FeedHeader } from '@/components/feed/FeedHeader';
import { StoriesTray } from '@/components/feed/StoriesTray';
import { DiffBanner, type FeedDiff } from '@/components/feed/DiffBanner';
import { PostCard } from '@/components/feed/PostCard';
import { Button, Icon, Touchable, VText } from '@/components/ui';
import { Block } from '@/components/ui/Surface';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { TAB_BAR_CLEARANCE } from '@/components/nav/LiquidTabBar';
import { diffRankings, rankFeed, type RankedPost } from '@/algo/engine';
import { budgetPressure, useVybe } from '@/store/useVybe';
import type { FeedMode } from '@/data/types';

const AnimatedFlatList = Animated.FlatList<RankedPost>;

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const pathname = usePathname();

  const posts = useVybe((s) => s.posts);
  const algo = useVybe((s) => s.algo);
  const circles = useVybe((s) => s.circles);
  const authors = useVybe((s) => s.authors);
  const viewerId = useVybe((s) => s.profile.id);
  const sync = useVybe((s) => s.sync);
  const loading = useVybe((s) => s.loading);
  const loadError = useVybe((s) => s.loadError);
  const mode = useVybe((s) => s.feedMode);
  const token = useVybe((s) => s.pendingDiffToken);
  const ledger = useVybe((s) => s.ledger);
  const budget = useVybe((s) => s.budget);
  const spendAttention = useVybe((s) => s.spendAttention);
  const markSeen = useVybe((s) => s.markSeen);
  const loadMorePosts = useVybe((s) => s.loadMorePosts);
  const loadingMore = useVybe((s) => s.loadingMore);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const listRef = useRef<any>(null);

  // Pull to refresh / re-sync implementation
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void sync({ silent: true }).finally(() => {
      setRefreshToken((t) => t + 1);
      setRefreshing(false);
    });
  }, [sync]);

  // Listen for active tab re-press to scroll to top and refresh
  const isFocused = useIsFocused();
  const prevPathname = useRef(pathname);
  useEffect(() => {
    if (isFocused && prevPathname.current === pathname) {
      listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
      onRefresh();
    }
    prevPathname.current = pathname;
  }, [isFocused, pathname, onRefresh]);

  const seenSnapshot = useMemo(
    () => new Set(useVybe.getState().seenIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [algo, circles, mode, refreshToken],
  );

  const postsById = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts]);
  const postIdsKey = useMemo(() => posts.map((p) => p.id).join(','), [posts]);

  const authorsRef = useRef(authors);
  authorsRef.current = authors;

  const baseRanked = useMemo(
    () =>
      rankFeed({
        posts,
        state: algo,
        circles,
        authors: authorsRef.current,
        viewerId,
        seenIds: seenSnapshot,
        mode,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postIdsKey, algo, circles, viewerId, mode, seenSnapshot, refreshToken],
  );

  const ranked = useMemo(() => {
    const live = baseRanked.map((item) => {
      const latest = postsById.get(item.post.id);
      return latest ? { ...item, post: latest } : item;
    });

    const unread = live.filter(
      (item) => item.post.authorId === viewerId || !seenSnapshot.has(item.post.id),
    );

    const FRESH_MS = 15 * 60_000;
    const now = Date.now();
    const isMineAndFresh = (p: { authorId: string; createdAt: number }) =>
      p.authorId === viewerId && now - p.createdAt < FRESH_MS;

    const mine = unread
      .filter((i) => isMineAndFresh(i.post))
      .sort((a, b) => b.post.createdAt - a.post.createdAt);

    if (!mine.length) return unread;
    return [...mine, ...unread.filter((i) => !isMineAndFresh(i.post))];
  }, [baseRanked, postsById, seenSnapshot, viewerId]);

  const topPostId = ranked[0]?.post.id;
  const announced = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!topPostId || !viewerId) return;
    const top = ranked[0]?.post;
    if (!top || top.authorId !== viewerId) return;
    if (Date.now() - top.createdAt > 15 * 60_000) return;
    if (announced.current === topPostId) return;
    announced.current = topPostId;
    listRef.current?.scrollToOffset?.({ offset: 0, animated: true });
  }, [topPostId, ranked, viewerId]);

  // Keep previous ranking for diff reports
  const previous = useRef<RankedPost[]>(ranked);
  const lastToken = useRef(token);
  const [diff, setDiff] = useState<FeedDiff | null>(null);

  useEffect(() => {
    if (token === lastToken.current) {
      previous.current = ranked;
      return;
    }
    lastToken.current = token;
    const d = diffRankings(previous.current, ranked);
    previous.current = ranked;
    setDiff({
      changed: d.changed,
      climbPostId: d.biggestClimb?.postId,
      climbBy: d.biggestClimb?.delta,
      fallPostId: d.biggestFall?.postId,
      fallBy: d.biggestFall?.delta,
      ledgerId: ledger.find((e) => !e.undone)?.id,
    });
    const t = setTimeout(() => setDiff(null), 6000);
    return () => clearTimeout(t);
  }, [token, ranked, ledger]);

  useEffect(() => {
    if (!isFocused) return;

    let active = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (s) => {
      active = s === 'active';
    });
    const i = setInterval(() => {
      if (active) spendAttention(5);
    }, 5000);

    return () => {
      sub.remove();
      clearInterval(i);
    };
  }, [isFocused, spendAttention]);

  const pressure = budgetPressure(budget);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 900 });
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    viewableItems.forEach((v: any) => v?.item?.post?.id && markSeen(v.item.post.id));
  });

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura intensity={1 - pressure * 0.7} />

      <AnimatedFlatList
        ref={listRef}
        data={ranked}
        keyExtractor={(item) => item.post.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshing={refreshing}
        onRefresh={onRefresh}
        viewabilityConfig={viewabilityConfig.current}
        onViewableItemsChanged={onViewableItemsChanged.current}
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.6}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={9}
        removeClippedSubviews
        ListFooterComponentStyle={{ width: '100%' }}
        contentContainerStyle={{
          paddingTop: insets.top + 118,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + space.xxl,
        }}
        ListHeaderComponent={
          <View style={{ marginBottom: space.sm }}>
            <StoriesTray />
          </View>
        }
        renderItem={({ item }) => (
          <PostCard post={item.post} receipt={item.receipt} calm={pressure} />
        )}
        ListFooterComponent={<FeedFooter pressure={pressure} loadingMore={loadingMore} />}
        ListEmptyComponent={
          <FeedEmpty
            loading={loading}
            error={loadError}
            mode={mode}
            caughtUp={posts.length > 0}
            onRefresh={onRefresh}
          />
        }
      />

      <FeedHeader scrollY={scrollY} />

      {diff ? (
        <View style={{ position: 'absolute', top: insets.top + 120, left: 0, right: 0 }}>
          <DiffBanner diff={diff} onDismiss={() => setDiff(null)} />
        </View>
      ) : null}
    </View>
  );
}

function FeedEmpty({
  loading,
  error,
  mode,
  caughtUp,
  onRefresh,
}: {
  loading: boolean;
  error: string | null;
  mode: FeedMode;
  caughtUp?: boolean;
  onRefresh?: () => void;
}) {
  const { c } = useTheme();
  const router = useRouter();

  if (loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.empty}>
        <VText variant="heading">Could not reach the server</VText>
        <VText variant="caption" muted style={{ textAlign: 'center', marginTop: 6 }}>
          Pull down to try again.
        </VText>
      </View>
    );
  }

  if (caughtUp) {
    return (
      <View style={styles.empty}>
        <VText variant="heading" style={{ textAlign: 'center' }}>
          You have read everything
        </VText>
        <VText
          variant="caption"
          muted
          style={{ textAlign: 'center', marginTop: 6, marginBottom: space.base }}
        >
          Posts drop off this list once you have seen them. Pull down, or check back later.
        </VText>
        <Button label="Refresh" glyph="refresh-cw" variant="ghost" onPress={() => onRefresh?.()} />
      </View>
    );
  }

  if (mode === 'circles' || mode === 'following') {
    return (
      <View style={styles.empty}>
        <VText variant="heading" style={{ textAlign: 'center' }}>
          {mode === 'circles' ? 'No Circles yet' : 'Nobody you follow has posted'}
        </VText>
        <VText variant="caption" muted style={{ textAlign: 'center', marginTop: 6, marginBottom: space.base }}>
          {mode === 'circles'
            ? 'Circles are your own groupings. Put someone in one and their posts show up here.'
            : 'Follow a few more people, or switch to For You.'}
        </VText>
        <Button
          label={mode === 'circles' ? 'Manage circles' : 'Find people'}
          glyph={mode === 'circles' ? 'users' : 'user-plus'}
          variant="ghost"
          onPress={() => router.push(mode === 'circles' ? '/circles' : '/people')}
        />
      </View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(320)} style={styles.firstRun}>
      <View style={[styles.firstRunCard, { backgroundColor: c.surfaceElevated }]}>
        <VText variant="heading">Your feed starts empty.</VText>
        <VText variant="caption" secondary style={{ marginTop: 6 }}>
          That is deliberate — nothing lands here that you did not put here. Three ways to
          begin.
        </VText>
      </View>

      <StartRow
        glyph="user-plus"
        title="Find people"
        blurb="The fastest way to fill this up. Follow a few and their posts arrive."
        accent
        onPress={() => router.push('/people')}
      />
      <StartRow
        glyph="edit-3"
        title="Write something"
        blurb="Your own posts show up here too, so the feed is never entirely other people."
        onPress={() => router.push('/compose')}
      />
      <StartRow
        glyph="sliders"
        title="Tune what you see"
        blurb="Change the subjects you picked, or how adventurous the ranking is."
        onPress={() => router.push('/(tabs)/algo')}
      />
    </Animated.View>
  );
}

function StartRow({
  glyph,
  title,
  blurb,
  accent,
  onPress,
}: {
  glyph: React.ComponentProps<typeof Icon>['name'];
  title: string;
  blurb: string;
  accent?: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      feedback="light"
      scaleTo={0.98}
      accessibilityLabel={`${title}. ${blurb}`}
      style={[
        styles.startRow,
        { backgroundColor: accent ? c.volt : c.surfaceElevated },
      ]}
    >
      <View
        style={[
          styles.startMark,
          { backgroundColor: accent ? 'rgba(0,0,0,0.12)' : c.bg },
        ]}
      >
        <Icon name={glyph} size={18} color={accent ? c.onVolt : c.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <VText variant="bodyMedium" color={accent ? c.onVolt : c.text}>
          {title}
        </VText>
        <VText
          variant="caption"
          color={accent ? c.onVolt : c.textSecondary}
          style={accent ? { opacity: 0.75 } : undefined}
        >
          {blurb}
        </VText>
      </View>
      <Icon name="chevron-right" size={18} color={accent ? c.onVolt : c.textMuted} />
    </Touchable>
  );
}

function FeedFooter({ pressure, loadingMore }: { pressure: number; loadingMore: boolean }) {
  const { c } = useTheme();
  const setBudget = useVybe((s) => s.setBudget);
  const budget = useVybe((s) => s.budget);

  if (loadingMore) {
    return (
      <View style={styles.footer}>
        <ActivityIndicator />
      </View>
    );
  }

  if (pressure < 1) {
    return (
      <View style={styles.footer}>
        <VText variant="subheading" muted>
          You are all caught up
        </VText>
      </View>
    );
  }

  return (
    <View style={styles.footer}>
      <Block accent={c.warning} style={{ gap: space.sm }}>
        <VText variant="heading">That is your {budget.limitMinutes} minutes</VText>
        <VText variant="caption" secondary>
          The feed is still here and nothing is locked. It just stopped trying to be interesting.
        </VText>
        <Button
          label="Give myself 10 more minutes"
          variant="ghost"
          style={{ marginTop: space.sm, alignSelf: 'flex-start' }}
          onPress={() => setBudget({ limitMinutes: budget.limitMinutes + 10 })}
        />
      </Block>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg },
  firstRun: { gap: space.sm, paddingTop: space.sm, paddingHorizontal: space.gutter },
  firstRunCard: { padding: space.lg, borderRadius: radius.xl, marginBottom: space.xs },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.xl,
  },
  startMark: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: { alignItems: 'center', paddingVertical: space.xl, paddingHorizontal: space.gutter },
});