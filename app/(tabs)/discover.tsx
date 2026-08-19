import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { TopScrim } from '@/components/TopScrim';
import { ScreenTitle } from '@/components/ui/ScreenTitle';
import { Avatar, Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { alpha, radius, space, type } from '@/theme/tokens';
import { TAB_BAR_CLEARANCE } from '@/components/nav/LiquidTabBar';
import { TOPICS, TOPIC_BY_ID } from '@/data/topics';
import { fmtCount } from '@/algo/engine';
import { searchProfiles } from '@/services/db';
import type { Author, Space } from '@/data/types';
import { useVybe } from '@/store/useVybe';

const MORE = 0.75;
const EDGE = 0.05;

export default function DiscoverScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');

  const weights = useVybe((s) => s.algo.topicWeights);
  const setTopicWeight = useVybe((s) => s.setTopicWeight);
  const circles = useVybe((s) => s.circles);
  const toggleCircleMember = useVybe((s) => s.toggleCircleMember);
  const posts = useVybe((s) => s.posts);
  const allSpaces = useVybe((s) => s.spaces);
  const cacheAuthors = useVybe((s) => s.cacheAuthors);
  const viewerId = useVybe((s) => s.profile.id);

  const [people, setPeople] = useState<Author[]>([]);
  const router = useRouter();

  const query = q.trim().toLowerCase();
  const searching = query.length > 0;
  const spaces = allSpaces.filter((s) => !query || s.name.toLowerCase().includes(query));
  const topics = TOPICS.filter((t) => !query || t.label.toLowerCase().includes(query));

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void searchProfiles(query, 20, viewerId).then((found) => {
        if (!live) return;
        setPeople(found || []);
        if (found?.length) cacheAuthors(found);
      });
    }, query ? 180 : 0);

    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, viewerId, cacheAuthors]);

  const hidden = useMemo(() => TOPICS.filter((t) => (weights[t.id] ?? 0) < -EDGE), [weights]);
  const countFor = (topicId: string) => posts.filter((p) => p.topics.includes(topicId)).length;

  const shownPeople = searching ? people : people.slice(0, 3);
  const nothing = !spaces.length && !topics.length && !people.length;

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + space.xxl,
          paddingHorizontal: space.gutter,
          gap: space.xl,
        }}
      >
        {/* Header & Search */}
        <View style={{ gap: space.base }}>
          <ScreenTitle
            title="Discover"
            subtitle="Rooms to join, subjects to follow, people to add. Nothing here reaches your feed unless you put it there."
          />

          <View style={[styles.search, { backgroundColor: c.bgSubtle }]}>
            <Icon name="search" size={16} color={c.textMuted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Rooms, people, subjects"
              placeholderTextColor={c.textMuted}
              style={[type.body, { flex: 1, color: c.text, paddingVertical: 11 }]}
              accessibilityLabel="Search rooms, people and subjects"
              returnKeyType="search"
            />
            {q ? (
              <Touchable onPress={() => setQ('')} hitSlop={12} accessibilityLabel="Clear search">
                <Icon name="x" size={16} color={c.textMuted} />
              </Touchable>
            ) : null}
          </View>
        </View>

        {/* People Section */}
        {shownPeople.length > 0 && (
          <View style={{ gap: space.md }}>
            <Head
              title="People"
              blurb="Put someone in a circle to change how they rank for you."
              action={{
                label: searching ? 'See all' : 'Add people',
                onPress: () =>
                  router.push(searching ? { pathname: '/people', params: { q: q.trim() } } : '/people'),
              }}
            />
            {shownPeople.map((a) => {
              const memberOf = circles.filter((cc) => cc.memberIds.includes(a.id));
              return (
                <View key={a.id} style={[styles.person, { borderColor: c.border }]}>
                  <Touchable
                    onPress={() => router.push(`/profile-view/${a.id}`)}
                    feedback="light"
                    scaleTo={1}
                    accessibilityLabel={`${a.name}, @${a.handle}`}
                    style={styles.personHead}
                  >
                    <Avatar uri={a.avatar} size={44} ring={memberOf[0]?.color} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <View style={styles.nameRow}>
                        <VText variant="bodyMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {a.name}
                        </VText>
                      </View>
                      <VText variant="micro" muted numberOfLines={1}>
                        @{a.handle} · {fmtCount(a.followers)} followers
                      </VText>
                    </View>
                    <Icon name="chevron-right" size={18} color={c.textMuted} />
                  </Touchable>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6 }}
                  >
                    {circles.map((cc) => (
                      <Chip
                        key={cc.id}
                        size="sm"
                        label={cc.name}
                        tone={cc.color}
                        active={cc.memberIds.includes(a.id)}
                        onPress={() => toggleCircleMember(cc.id, a.id)}
                      />
                    ))}
                    {!circles.length ? (
                      <Chip
                        size="sm"
                        label="Make a circle first"
                        glyph="plus"
                        onPress={() => router.push('/circles')}
                      />
                    ) : null}
                  </ScrollView>
                </View>
              );
            })}
          </View>
        )}

        {/* Subjects / Topics Grid */}
        {topics.length > 0 && (
          <View style={{ gap: space.md }}>
            <Head title="Subjects" blurb="Tap one to see more of it. Tap again to stop." />
            <View style={styles.grid}>
              {topics.map((t) => {
                const on = (weights[t.id] ?? 0) > EDGE;
                return (
                  <Touchable
                    key={t.id}
                    onPress={() => {
                      haptic('select');
                      setTopicWeight(t.id, on ? 0 : MORE, 'panel');
                    }}
                    feedback="none"
                    scaleTo={0.96}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t.label}
                    style={[
                      styles.tile,
                      {
                        backgroundColor: t.hue,
                        borderColor: on ? c.volt : 'transparent',
                      },
                    ]}
                  >
                    {t.image ? (
                      <Image
                        source={{ uri: t.image }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={220}
                        cachePolicy="memory-disk"
                        recyclingKey={t.id}
                      />
                    ) : null}

                    <LinearGradient
                      colors={
                        on
                          ? ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.72)']
                          : ['rgba(0,0,0,0.42)', 'rgba(0,0,0,0.86)']
                      }
                      style={StyleSheet.absoluteFill}
                    />

                    {on ? (
                      <View style={[styles.tileCheck, { backgroundColor: c.volt }]}>
                        <Icon name="check" size={13} color={c.onVolt} />
                      </View>
                    ) : null}

                    <View style={styles.tileBody}>
                      <VText variant="bodyMedium" color="#FFFFFF" numberOfLines={1}>
                        {t.label}
                      </VText>
                      <VText variant="micro" color="rgba(255,255,255,0.7)">
                        {countFor(t.id)} in your feed
                      </VText>
                    </View>
                  </Touchable>
                );
              })}
            </View>
          </View>
        )}

        {/* Rooms / Spaces */}
        {spaces.length > 0 && (
          <View style={{ gap: space.md }}>
            <Head title="Rooms" blurb="Shared spaces with their own rules and their own moderators." />
            {spaces.map((s) => (
              <RoomCard key={s.id} space={s} />
            ))}
          </View>
        )}

        {/* Hidden Blindspots */}
        {hidden.length > 0 && (
          <View style={{ gap: space.md }}>
            <Head title="What you are not seeing" blurb="Your own blind spots, listed plainly." />
            <Animated.View layout={LinearTransition} style={styles.chips}>
              {hidden.map((t) => (
                <Animated.View key={t.id} entering={FadeIn}>
                  <Chip
                    label={t.label}
                    glyph="eye"
                    onPress={() => {
                      haptic('light');
                      setTopicWeight(t.id, 0, 'panel');
                    }}
                  />
                </Animated.View>
              ))}
            </Animated.View>
          </View>
        )}

        {/* Empty State */}
        {nothing ? (
          <View style={styles.empty}>
            <VText variant="heading">Nothing matches “{q.trim()}”</VText>
            <VText variant="caption" muted style={{ marginTop: 6, textAlign: 'center' }}>
              Try a shorter word, or clear the search to browse everything.
            </VText>
          </View>
        ) : null}
      </ScrollView>
      <TopScrim />
    </View>
  );
}

function RoomCard({ space: s }: { space: Space }) {
  const { c } = useTheme();
  const router = useRouter();
  const glyph = (TOPIC_BY_ID[s.topics[0]]?.glyph ?? 'hash') as React.ComponentProps<
    typeof Icon
  >['name'];

  return (
    <Touchable
      onPress={() => router.push(`/room/${s.id}`)}
      feedback="light"
      scaleTo={0.985}
      accessibilityLabel={`${s.name}, ${fmtCount(s.members)} members`}
      style={[styles.room, { backgroundColor: c.surfaceElevated }]}
    >
      <LinearGradient
        colors={[alpha(s.hue, 0.34), alpha(s.hue, 0.05)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View pointerEvents="none" style={styles.roomGlyph}>
        <Icon name={glyph} size={132} color={alpha(s.hue, 0.16)} />
      </View>

      <View style={{ gap: 6 }}>
        <VText variant="title" numberOfLines={1}>
          {s.name}
        </VText>
        <VText variant="caption" secondary numberOfLines={2} style={{ maxWidth: '86%' }}>
          {s.description}
        </VText>
      </View>

      <View style={styles.roomFoot}>
        <VText variant="micro" muted style={{ flex: 1 }}>
          {fmtCount(s.members)} members
        </VText>

        <Chip size="sm" label="Join" glyph="plus" />
      </View>
    </Touchable>
  );
}

function Head({
  title,
  blurb,
  action,
}: {
  title: string;
  blurb: string;
  action?: { label: string; onPress: () => void };
}) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.headRow}>
        <VText variant="heading" style={{ flex: 1 }}>
          {title}
        </VText>
        {action ? (
          <Touchable
            onPress={action.onPress}
            feedback="light"
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            style={styles.headAction}
          >
            <VText variant="label" color={c.primary}>
              {action.label}
            </VText>
            <Icon name="arrow-right" size={14} color={c.primary} />
          </Touchable>
        ) : null}
      </View>
      <VText variant="caption" secondary>
        {blurb}
      </VText>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    width: '48%',
    flexGrow: 1,
    borderRadius: radius.lg,
    borderWidth: 2,
    minHeight: 104,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  tileBody: { padding: space.md, gap: 2, zIndex: 1 },
  tileCheck: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  room: {
    gap: space.base,
    padding: space.base,
    borderRadius: radius.xl,
    overflow: 'hidden',
    minHeight: 148,
    justifyContent: 'space-between',
  },
  roomGlyph: { position: 'absolute', right: -26, bottom: -34 },
  roomFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32 },
  person: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  personHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  empty: { alignItems: 'center', paddingVertical: space.xxl },
});