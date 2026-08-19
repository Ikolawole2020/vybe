import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { Avatar, Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';
import { searchProfiles } from '@/services/db';
import type { Author } from '@/data/types';
import { fmtCount } from '@/algo/engine';
import { useVybe } from '@/store/useVybe';

/**
 * Find someone by name or nickname, and put them somewhere.
 *
 * Adding a person on Vybe is not a single "follow" — it is choosing which
 * circle they go in, because the circle is what decides how much they count.
 * So the result row leads with the circle chips rather than hiding them behind
 * a follow that would have to be qualified afterwards.
 */
export default function PeopleScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { q: handed } = useLocalSearchParams<{ q?: string }>();
  const [q, setQ] = useState(handed ?? '');

  const circles = useVybe((s) => s.circles);
  const toggleCircleMember = useVybe((s) => s.toggleCircleMember);

  const cacheAuthors = useVybe((s) => s.cacheAuthors);
  const viewerId = useVybe((s) => s.profile.id);

  const [results, setResults] = useState<Author[]>([]);
  const [searching, setSearching] = useState(true);

  const query = q.trim();

  useEffect(() => {
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      void searchProfiles(query, 40, viewerId).then((found) => {
        if (!live) return;
        setResults(found || []);
        setSearching(false);
        if (found?.length) cacheAuthors(found);
      });
    }, query ? 180 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, viewerId, cacheAuthors]);

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: insets.bottom + space.xxl,
          paddingHorizontal: space.gutter,
          gap: space.lg,
        }}
      >
        <View style={{ gap: space.md }}>
          <Touchable
            onPress={() => goBack()}
            feedback="light"
            hitSlop={10}
            accessibilityLabel="Back"
            style={styles.back}
          >
            <Icon name="arrow-left" size={20} color={c.text} />
            <VText variant="label" secondary>
              Back
            </VText>
          </Touchable>

          <VText variant="hero">Add people</VText>
          <VText variant="body" secondary>
            Search by name or nickname, then pick which circle they belong in.
          </VText>

          <View style={[styles.search, { backgroundColor: c.bgSubtle }]}>
            <Icon name="search" size={16} color={c.textMuted} />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Name or @nickname"
              placeholderTextColor={c.textMuted}
              style={[type.body, { flex: 1, color: c.text, paddingVertical: 11 }]}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search people by name or nickname"
              returnKeyType="search"
            />
            {q ? (
              <Touchable onPress={() => setQ('')} hitSlop={12} accessibilityLabel="Clear search">
                <Icon name="x" size={16} color={c.textMuted} />
              </Touchable>
            ) : null}
          </View>
        </View>

        <Animated.View layout={LinearTransition} style={{ gap: space.sm }}>
          {results.map((a) => {
            const memberOf = circles.filter((cc) => cc.memberIds.includes(a.id));
            return (
              <Animated.View key={a.id} entering={FadeIn.duration(160)}>
                <View style={[styles.person, { borderColor: c.border }]}>
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
                    {memberOf.length ? (
                      <VText variant="micro" color={memberOf[0].color}>
                        Added
                      </VText>
                    ) : null}
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
                        onPress={() => {
                          haptic('select');
                          toggleCircleMember(cc.id, a.id);
                        }}
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
              </Animated.View>
            );
          })}

          {results.length || searching ? null : (
            <View style={styles.empty}>
              <VText variant="heading">
                {query ? `Nobody called “${query}”` : 'Nobody here yet'}
              </VText>
              <VText variant="caption" muted style={{ marginTop: 6, textAlign: 'center' }}>
                {query
                  ? 'Try part of a name, or their nickname without the @.'
                  : 'Vybe is new. When someone else joins, they will show up here.'}
              </VText>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
  },
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