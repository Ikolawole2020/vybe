import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { LinearGradient } from 'expo-linear-gradient';
import { AmbientAura } from '@/components/AmbientAura';
import { PostCard } from '@/components/feed/PostCard';
import { Reveal } from '@/components/ui/Reveal';
import { Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { alpha, space } from '@/theme/tokens';
import { TOPIC_BY_ID } from '@/data/topics';
import { fmtCount, rankFeed } from '@/algo/engine';
import { useVybe } from '@/store/useVybe';

/**
 * Inside a room.
 *
 * The posts are the real ones, filtered to the room's subjects — a room is a
 * view onto the same corpus rather than a separate silo, which is what makes
 * joining one a low-stakes decision.
 */
export default function RoomScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const posts = useVybe((s) => s.posts);
  const algo = useVybe((s) => s.algo);
  const circles = useVybe((s) => s.circles);

  const spaces = useVybe((s) => s.spaces);
  const authors = useVybe((s) => s.authors);
  const joined = useVybe((s) => (id ? s.joinedSpaceIds.includes(id) : false));
  const toggleSpaceMember = useVybe((s) => s.toggleSpaceMember);

  const room = spaces.find((s) => s.id === id);

  // Ranked by the same engine as the feed, just over the room's slice — a room
  // is a different set of posts, not a different set of rules.
  const inRoom = useMemo(() => {
    if (!room) return [];
    const relevant = posts.filter((p) => p.topics.some((t) => room.topics.includes(t)));
    return rankFeed({
      posts: relevant,
      state: algo,
      circles,
      authors,
      seenIds: new Set<string>(),
      mode: 'for-you',
    });
  }, [room, posts, algo, circles, authors]);


  if (!room) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + space.xxl }]}>
        <VText variant="heading">That room does not exist.</VText>
      </View>
    );
  }

  const glyph = (TOPIC_BY_ID[room.topics[0]]?.glyph ?? 'hash') as React.ComponentProps<
    typeof Icon
  >['name'];

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + space.xxl,
          gap: space.lg,
        }}
      >
        {/* The banner carries the room's colour full-bleed, so arriving here
            feels like entering somewhere rather than opening a list. */}
        <View style={[styles.banner, { paddingTop: insets.top + space.base }]}>
          <LinearGradient
            colors={[alpha(room.hue, 0.42), 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.bannerGlyph}>
            <Icon name={glyph} size={168} color={alpha(room.hue, 0.15)} />
          </View>

          <Touchable
            onPress={() => goBack()}
            feedback="light"
            hitSlop={10}
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Icon name="arrow-left" size={20} color={c.text} />
          </Touchable>

          <View style={{ gap: space.sm, paddingTop: space.xl }}>
            <VText variant="mega">{room.name}</VText>
            <VText variant="body" secondary style={{ maxWidth: '88%' }}>
              {room.description}
            </VText>

            <View style={styles.memberRow}>
              <VText variant="caption" muted>
                {fmtCount(room.members)} members
              </VText>
            </View>

            <Button
              label={joined ? 'Joined' : 'Join this room'}
              glyph={joined ? 'check' : 'plus'}
              variant={joined ? 'ghost' : 'primary'}
              onPress={() => {
                haptic(joined ? 'light' : 'success');
                toggleSpaceMember(room.id);
              }}
              style={{ alignSelf: 'flex-start', marginTop: space.sm }}
            />
          </View>
        </View>

        <View style={{ paddingHorizontal: space.gutter, gap: space.md }}>
          <VText variant="heading">In here now</VText>

          {inRoom.length ? (
            // Post rows are full-bleed and bring their own gutter, so they
            // reach back out through this section's inset.
            inRoom.map((r, i) => (
              <Reveal key={r.post.id} index={Math.min(i, 6)}>
                <View style={{ marginHorizontal: -space.gutter }}>
                  <PostCard post={r.post} receipt={r.receipt} />
                </View>
              </Reveal>
            ))
          ) : (
            <VText variant="caption" muted>
              Nothing posted to this room yet. Be the first — tag a post with{' '}
              {room.topics.map((t) => TOPIC_BY_ID[t]?.label ?? t).join(' or ')}.
            </VText>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: space.gutter },
  banner: {
    paddingHorizontal: space.gutter,
    paddingBottom: space.lg,
    overflow: 'hidden',
  },
  bannerGlyph: { position: 'absolute', right: -40, top: 20 },
  back: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  stack: { flexDirection: 'row', alignItems: 'center' },
  face: { borderRadius: 15, borderWidth: 2 },
});
