import React, { memo, useCallback } from 'react';
import { ActionSheetIOS, Alert, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Avatar, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, spring } from '@/theme/tokens';
import { TOPIC_BY_ID } from '@/data/topics';
import { fmtAge, fmtCount } from '@/algo/engine';
import type { Post, ScoreReceipt } from '@/data/types';
import { useAuthor, usePost, useVybe } from '@/store/useVybe';
import { PollCard } from '@/components/feed/PollCard';
import { MediaGrid } from '@/components/feed/MediaGrid';
import { VoiceNotePlayer } from '@/components/ui/VoiceNotePlayer';

const AVATAR = 42;

type Props = {
  post: Post;
  receipt?: ScoreReceipt;
  calm?: number;
  onVisible?: (id: string) => void;
  detail?: boolean;
};

function QuotedPostEmbed({ quotePostId }: { quotePostId: string }) {
  const { c } = useTheme();
  const router = useRouter();
  const quotedPost = usePost(quotePostId);
  const quotedAuthor = useAuthor(quotedPost?.authorId);

  if (!quotedPost) return null;

  const handlePress = () => {
    router.push(`/post/${quotedPost.id}`);
  };

  return (
    <Touchable
      onPress={handlePress}
      feedback="light"
      scaleTo={0.99}
      style={[
        styles.quotedContainer,
        { borderColor: c.border, backgroundColor: c.surfaceElevated },
      ]}
      accessibilityLabel={`Quoted post by ${quotedAuthor?.name ?? 'user'}`}
    >
      <View style={styles.quotedHeader}>
        <Avatar uri={quotedAuthor?.avatar ?? ''} size={20} />
        <VText variant="bodyMedium" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>
          {quotedAuthor?.name ?? 'Unknown account'}
        </VText>
        <VText variant="micro" muted numberOfLines={1}>
          @{quotedAuthor?.handle} · {fmtAge((Date.now() - quotedPost.createdAt) / 3600_000)}
        </VText>
      </View>

      {quotedPost.body ? (
        <VText variant="caption" numberOfLines={3} color={c.text}>
          {quotedPost.body}
        </VText>
      ) : null}

  {quotedPost.media && quotedPost.media.length > 0 ? (
        <View style={styles.quotedMedia}>
          <MediaGrid
            media={quotedPost.media}
            postId={quotedPost.id}
            kind={quotedPost.kind}
            onDoubleTapLike={() => {}}
          />
        </View>
      ) : null}
    </Touchable>
  );
}

function PostCardBase({ post, receipt, calm = 0, detail = false }: Props) {
  const { c } = useTheme();
  const router = useRouter();
  const author = useAuthor(post.authorId);
  const viewerId = useVybe((s) => s.profile.id);

  const isOwnPost = Boolean(viewerId) && post.authorId === viewerId;

  const liked = useVybe((s) => s.liked.includes(post.id));
  const saved = useVybe((s) => s.saved.includes(post.id));
  const boosted = useVybe((s) => s.boosted.includes(post.id));
  const toggleLike = useVybe((s) => s.toggleLike);
  const toggleSave = useVybe((s) => s.toggleSave);
  const toggleBoost = useVybe((s) => s.toggleBoost);
  const removePost = useVybe((s) => s.removePost);
  const votePoll = useVybe((s) => s.votePoll);
  const circles = useVybe((s) => s.circles);

  const memberCircle = circles.find((cc) => cc.memberIds.includes(post.authorId));

  const heart = useSharedValue(0);
  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + heart.value * 0.45 }],
  }));

  const onLike = useCallback(() => {
    heart.value = withSequence(withTiming(1, { duration: 110 }), withSpring(0, spring.snappy));
    toggleLike(post.id);
  }, [heart, post.id, toggleLike]);

  const hasMedia = post.media.length > 0;

  const openAuthor = () =>
    isOwnPost ? router.push('/(tabs)/profile') : router.push(`/profile-view/${post.authorId}`);

  const openPost = () => {
    if (detail) return;
    router.push(`/post/${post.id}`);
  };

  const handleShareDM = () => {
    haptic('light');
    router.push(`/messages?sharePostId=${post.id}` as any);
  };

  const handleQuote = () => {
    haptic('light');
    router.push(`/compose?quote=${post.id}`);
  };

  const handleBoostOrQuote = () => {
    haptic('medium');

    if (Platform.OS === 'web') {
      const shouldQuote = window.confirm(
        boosted
          ? 'Would you like to Quote this post? (Click "Cancel" to Undo Boost)'
          : 'Would you like to Quote this post? (Click "Cancel" to Boost)'
      );
      if (shouldQuote) {
        handleQuote();
      } else {
        toggleBoost(post.id);
      }
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', boosted ? 'Undo Boost' : 'Boost', 'Quote Post'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) toggleBoost(post.id);
          else if (buttonIndex === 2) handleQuote();
        }
      );
    } else {
      Alert.alert('Boost or Quote', undefined, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: boosted ? 'Undo Boost' : 'Boost',
          onPress: () => toggleBoost(post.id),
        },
        {
          text: 'Quote Post',
          onPress: handleQuote,
        },
      ]);
    }
  };

  const handleDeletePost = () => {
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
          },
        },
      ]
    );
  };

  const shownTopics = post.topics.slice(0, 2);
  const extraTopics = post.topics.length - shownTopics.length;

  return (
    <View
      style={[
        styles.row,
        { borderBottomColor: c.divider },
        styles.panY,
      ]}
    >
      <Touchable
        onPress={openAuthor}
        feedback="light"
        scaleTo={0.92}
        accessibilityLabel={`${author?.name}, @${author?.handle}`}
        style={[styles.gutter, styles.panY]}
      >
        <Avatar uri={author?.avatar ?? ''} size={AVATAR} ring={memberCircle?.color} />
      </Touchable>

      <View style={[styles.column, styles.panY]}>
        <View style={[styles.identity, styles.panY]}>
          <Touchable
            onPress={openAuthor}
            feedback="none"
            scaleTo={1}
            style={[styles.identityText, styles.panY]}
            accessibilityLabel={`${author?.name}, @${author?.handle}`}
          >
            <VText variant="bodyMedium" numberOfLines={1}>
              {author?.name ?? 'Unknown account'}
            </VText>
            <View style={[styles.handleRow, styles.panY]}>
              <VText variant="micro" muted numberOfLines={1} style={{ flexShrink: 1 }}>
                @{author?.handle}
              </VText>
              <VText variant="micro" muted>
                · {fmtAge((Date.now() - post.createdAt) / 3600_000)}
              </VText>
            </View>
          </Touchable>

          <View style={{ flex: 1, minWidth: 8 }} />

          {isOwnPost ? (
            <Touchable
              onPress={handleDeletePost}
              feedback="light"
              hitSlop={10}
              scaleTo={0.9}
              style={[styles.deleteBtn, styles.panY]}
              accessibilityLabel="Delete post"
            >
              <Icon name="trash-2" size={16} color="#FF453A" />
            </Touchable>
          ) : null}
        </View>

        {post.body ? (
          <Touchable
            onPress={openPost}
            feedback="none"
            scaleTo={1}
            accessibilityLabel={`Post by ${author?.name}. ${post.body}`}
            style={[styles.bodyTap, styles.panY]}
          >
            <VText variant="body" numberOfLines={detail ? undefined : 6}>
              {post.body}
            </VText>
          </Touchable>
        ) : null}

        {post.quotePostId ? <QuotedPostEmbed quotePostId={post.quotePostId} /> : null}

        {hasMedia ? (
          <View style={[styles.media, styles.panY]}>
            <MediaGrid
              media={post.media}
              postId={post.id}
              kind={post.kind}
              onDoubleTapLike={onLike}
            />
          </View>
        ) : null}

        {post.voiceNote ? <VoiceNotePlayer voiceNote={post.voiceNote} /> : null}

        {post.poll ? (
          <PollCard poll={post.poll} onVote={(optId) => votePoll(post.id, optId)} />
        ) : null}

        {shownTopics.length ? (
          <View style={[styles.topics, styles.panY]}>
            {shownTopics.map((t) => {
              const topic = TOPIC_BY_ID[t];
              return (
                <View key={t} style={[styles.topicItem, styles.panY]}>
                  <View style={[styles.topicDot, { backgroundColor: topic?.hue ?? c.textMuted }]} />
                  <VText variant="micro" muted>
                    {topic?.label ?? t}
                  </VText>
                </View>
              );
            })}
            {extraTopics > 0 ? (
              <VText variant="micro" muted>
                +{extraTopics}
              </VText>
            ) : null}
          </View>
        ) : null}

        <View style={[styles.actionBar, styles.panY]}>
          <Action
            glyph="message-circle"
            count={post.comments}
            label="Comment"
            onPress={openPost}
          />
          <Action
            glyph="repeat"
            count={post.boosts}
            active={boosted}
            activeColor={c.cyan}
            label="Boost or quote"
            onPress={handleBoostOrQuote}
          />
          <Action
            glyph="heart"
            count={post.likes}
            active={liked}
            activeColor={c.ember}
            label="Like"
            onPress={onLike}
            animatedStyle={heartStyle}
          />
          <Action
            glyph="bookmark"
            active={saved}
            activeColor={c.primary}
            label="Save"
            onPress={() => toggleSave(post.id)}
          />
          <Action glyph="send" label="Share" onPress={handleShareDM} />
        </View>
      </View>
    </View>
  );
}

function Action({
  glyph,
  count,
  active,
  activeColor,
  label,
  onPress,
  animatedStyle,
}: {
  glyph: React.ComponentProps<typeof Icon>['name'];
  count?: number;
  active?: boolean;
  activeColor?: string;
  label: string;
  onPress: () => void;
  animatedStyle?: any;
}) {
  const { c } = useTheme();
  const tint = active ? (activeColor ?? c.primary) : c.textMuted;
  return (
    <Touchable
      onPress={onPress}
      feedback={active ? 'light' : 'medium'}
      hitSlop={8}
      scaleTo={0.88}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      style={[styles.action, styles.panY]}
    >
      <Animated.View style={animatedStyle}>
        <Icon name={glyph} size={17} color={tint} />
      </Animated.View>
      {count != null && count > 0 ? (
        <VText variant="numeric" color={tint} style={{ fontSize: 12.5, marginLeft: 5 }}>
          {fmtCount(count)}
        </VText>
      ) : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  panY: Platform.select({
    web: {
      touchAction: 'pan-y',
    } as any,
    default: {},
  }),
  row: {
    flexDirection: 'row',
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gutter: { paddingRight: space.md, paddingTop: 2 },
  column: { flex: 1, gap: space.sm },
  identity: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  identityText: { flexShrink: 1, gap: 2, maxWidth: '85%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'nowrap' },
  deleteBtn: { padding: 4, borderRadius: radius.pill, marginTop: 2 },
  bodyTap: { marginTop: -2 },
  media: { marginTop: 2 },
  topics: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  topicItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  topicDot: { width: 6, height: 6, borderRadius: 3 },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: space.lg,
    marginTop: 2,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 34,
    paddingRight: 2,
  },
  quotedContainer: {
    marginTop: 6,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md,
    gap: space.xs,
  },
  quotedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginBottom: 2,
  },
  quotedMedia: {
    marginTop: 4,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
});

export const PostCard = memo(PostCardBase);