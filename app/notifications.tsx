import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { Image } from 'expo-image';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { Avatar, Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { fmtAge } from '@/algo/engine';
import { useAuthor, useVybe } from '@/store/useVybe';
import { fetchRemoteNotifications, markRemoteNotificationsRead, type NotificationRow } from '@/services/db';
import type { Post } from '@/data/types';

type NotificationType =
  | 'like'
  | 'boost'
  | 'comment'
  | 'follow'
  | 'circle'
  | 'profile_view'
  | 'post';

const KNOWN_TYPES: readonly NotificationType[] = [
  'like',
  'boost',
  'comment',
  'follow',
  'circle',
  'profile_view',
  'post',
];

type NotificationItem = {
  id: string;
  type: NotificationType;
  actorId: string;
  postId?: string;
  createdAt: number;
  read: boolean;
};

type FilterType = 'all' | 'views' | 'likes' | 'boosts' | 'comments' | 'follows' | 'posts';

const FILTERS: { id: FilterType; label: string; glyph?: React.ComponentProps<typeof Icon>['name'] }[] = [
  { id: 'all', label: 'All' },
  { id: 'views', label: 'Views', glyph: 'eye' },
  { id: 'likes', label: 'Likes', glyph: 'heart' },
  { id: 'boosts', label: 'Boosts', glyph: 'repeat' },
  { id: 'comments', label: 'Replies', glyph: 'message-circle' },
  { id: 'follows', label: 'Follows', glyph: 'user-plus' },
  { id: 'posts', label: 'Posts', glyph: 'edit-3' },
];

export default function NotificationsScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const posts = useVybe((s) => s.posts);
  const authors = useVybe((s) => s.authors);
  const viewerId = useVybe((s) => s.profile.id);
  const circles = useVybe((s) => s.circles);

  const [filter, setFilter] = useState<FilterType>('all');
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [remoteRows, setRemoteRows] = useState<NotificationRow[]>([]);

  useEffect(() => {
    if (!viewerId) return;
    let live = true;
    void fetchRemoteNotifications(viewerId).then((rows) => {
      if (live && rows.length > 0) {
        setRemoteRows(rows);
      }
    });
    return () => {
      live = false;
    };
  }, [viewerId]);

  const notifications = useMemo(
    () =>
      remoteRows
        .map((r) => ({
          id: r.id,
          type: (r.type === 'reply' ? 'comment' : r.type) as NotificationType,
          actorId: r.actor_id,
          postId: r.post_id ?? undefined,
          createdAt: new Date(r.created_at).getTime(),
          read: r.read || readIds.has(r.id),
        }))
        .filter((n) => KNOWN_TYPES.includes(n.type))
        .sort((a, b) => b.createdAt - a.createdAt),
    [remoteRows, readIds],
  );

  const filtered = useMemo(() => {
    if (filter === 'all') return notifications;
    if (filter === 'views') return notifications.filter((n) => n.type === 'profile_view');
    if (filter === 'likes') return notifications.filter((n) => n.type === 'like');
    if (filter === 'boosts') return notifications.filter((n) => n.type === 'boost');
    if (filter === 'comments') return notifications.filter((n) => n.type === 'comment');
    if (filter === 'follows') return notifications.filter((n) => n.type === 'follow');
    if (filter === 'posts') return notifications.filter((n) => n.type === 'post');
    return notifications;
  }, [notifications, filter]);

  const clearUnreadNotifications = useVybe((s) => s.clearUnreadNotifications);

  useEffect(() => {
    clearUnreadNotifications();
    if (viewerId) {
      void markRemoteNotificationsRead(viewerId);
    }
  }, [clearUnreadNotifications, viewerId]);

  const markAllAsRead = () => {
    haptic('light');
    setReadIds(new Set(notifications.map((n) => n.id)));
    clearUnreadNotifications();
    if (viewerId) {
      void markRemoteNotificationsRead(viewerId);
    }
  };

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <AmbientAura intensity={0.6} />

      {/* Fixed Top Header */}
      <View
        style={[
          styles.headerWrap,
          {
            paddingTop: insets.top + space.sm,
            backgroundColor: c.bg,
            borderBottomColor: c.divider,
          },
        ]}
      >
        <View style={styles.topRow}>
          <Touchable
            onPress={() => goBack()}
            feedback="light"
            hitSlop={10}
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Icon name="arrow-left" size={20} color={c.text} />
            <VText variant="label" secondary>
              Feed
            </VText>
          </Touchable>

          {hasUnread ? (
            <Touchable
              onPress={markAllAsRead}
              feedback="light"
              hitSlop={10}
              accessibilityLabel="Mark all as read"
              style={styles.markRead}
            >
              <VText variant="caption" color={c.primary}>
                Mark all as read
              </VText>
            </Touchable>
          ) : null}
        </View>

        <VText variant="hero" style={{ paddingHorizontal: space.gutter, marginBottom: space.sm }}>
          Notifications
        </VText>

        {/* Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterStrip}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              glyph={f.glyph}
              size="sm"
              active={filter === f.id}
              onPress={() => {
                haptic('select');
                setFilter(f.id);
              }}
            />
          ))}
        </ScrollView>
      </View>

      {/* Notifications List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + space.xxl,
          paddingTop: space.xs,
        }}
        renderItem={({ item, index }) => (
          <NotificationRow item={item} index={index} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="bell-off" size={32} color={c.textMuted} />
            <VText variant="heading" style={{ marginTop: space.sm }}>
              Nothing here yet
            </VText>
            <VText variant="caption" muted style={{ textAlign: 'center', marginTop: 4 }}>
              When someone likes or reposts your posts, you will see it here.
            </VText>
          </View>
        }
      />
    </View>
  );
}

function NotificationRow({ item, index }: { item: NotificationItem; index: number }) {
  const { c } = useTheme();
  const router = useRouter();
  const author = useAuthor(item.actorId);
  const post = useVybe((s) => (item.postId ? s.posts.find((p) => p.id === item.postId) : undefined));
  const circles = useVybe((s) => s.circles);

  const memberCircle = circles.find((cc) => cc.memberIds.includes(item.actorId));

  const typeMeta =
    {
      like: { glyph: 'heart' as const, color: c.ember, text: 'liked your post' },
      boost: { glyph: 'repeat' as const, color: c.primary, text: 'reposted your post' },
      comment: { glyph: 'message-circle' as const, color: c.cyan ?? c.primary, text: 'replied to your post' },
      follow: { glyph: 'user-plus' as const, color: c.accent ?? c.volt, text: 'started following you' },
      circle: { glyph: 'users' as const, color: c.volt, text: 'added you to a circle' },
      profile_view: { glyph: 'eye' as const, color: c.volt, text: 'viewed your profile' },
      post: { glyph: 'edit-3' as const, color: c.primary, text: 'posted something new' },
    }[item.type] ?? {
      glyph: 'bell' as const,
      color: c.textMuted,
      text: 'sent you a notification',
    };

  const handleRowPress = () => {
    haptic('light');
    if (item.postId) {
      router.push(`/post/${item.postId}`);
    } else if (item.actorId) {
      router.push(`/profile-view/${item.actorId}`);
    }
  };

  const handleAvatarPress = () => {
    haptic('light');
    router.push(`/profile-view/${item.actorId}`);
  };

  return (
    <Animated.View entering={FadeIn.delay(Math.min(index * 20, 200))}>
      <Touchable
        onPress={handleRowPress}
        feedback="light"
        scaleTo={0.99}
        accessibilityLabel={`${author?.name ?? 'Someone'} ${typeMeta.text}`}
        style={[
          styles.row,
          {
            backgroundColor: item.read ? 'transparent' : c.surfaceElevated,
            borderColor: c.border,
          },
        ]}
      >
        <View style={styles.avatarWrap}>
          <Touchable
            onPress={handleAvatarPress}
            feedback="light"
            scaleTo={0.92}
            accessibilityLabel={`View ${author?.name ?? 'author'}'s profile`}
          >
            <Avatar uri={author?.avatar} size={44} ring={memberCircle?.color} />
          </Touchable>
          <View style={[styles.typeBadge, { backgroundColor: typeMeta.color }]}>
            <Icon name={typeMeta.glyph} size={10} color="#FFFFFF" />
          </View>
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <VText variant="body" numberOfLines={2}>
            <VText variant="bodyMedium">{author?.name ?? 'Someone'} </VText>
            <VText secondary>{typeMeta.text}</VText>
          </VText>

          <VText variant="micro" muted>
            {fmtAge((Date.now() - item.createdAt) / 3600_000)} ago
          </VText>
        </View>

        {post ? <PostPreview post={post} /> : null}
      </Touchable>
    </Animated.View>
  );
}

function PostPreview({ post }: { post: Post }) {
  const { c } = useTheme();

  if (post.media && post.media.length > 0) {
    return (
      <View style={[styles.postThumb, { borderColor: c.border }]}>
        <Image source={{ uri: post.media[0] }} style={StyleSheet.absoluteFill} contentFit="cover" />
      </View>
    );
  }

  return (
    <View style={[styles.postThumb, styles.postTextThumb, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
      <VText variant="micro" muted numberOfLines={3} style={{ fontSize: 9, lineHeight: 12 }}>
        {post.body || 'Post'}
      </VText>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    marginBottom: space.xs,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  markRead: { minHeight: 44, justifyContent: 'center' },
  filterStrip: { paddingHorizontal: space.gutter, gap: space.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.gutter,
    minHeight: 68,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatarWrap: { position: 'relative' },
  typeBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000000',
  },

  postThumb: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  postTextThumb: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
  },
});