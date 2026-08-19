import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { TopScrim } from '@/components/TopScrim';
import { Slider } from '@/components/ui/Slider';
import { Avatar, Chip, Icon, SectionHeader, Touchable, VText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useAuthor, useVybe } from '@/store/useVybe';

const NEW_CIRCLE_PRESETS = [
  { name: 'Football', color: '#C2F53F', glyph: 'target' },
  { name: 'Studio', color: '#FF5C7A', glyph: 'music' },
  { name: 'Neighbours', color: '#3DD9EB', glyph: 'map-pin' },
  { name: 'Old School', color: '#FFB020', glyph: 'book' },
];

export default function CirclesScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const circles = useVybe((s) => s.circles);
  const toggleCircleMember = useVybe((s) => s.toggleCircleMember);
  const setCircleBoost = useVybe((s) => s.setCircleBoost);
  const addCircle = useVybe((s) => s.addCircle);

  const [expanded, setExpanded] = useState<string | null>(circles[0]?.id ?? null);

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
        <View style={styles.head}>
          <Touchable onPress={() => goBack()} feedback="light" hitSlop={10} accessibilityLabel="Back">
            <Icon name="chevron-left" size={24} color={c.text} />
          </Touchable>
          <View style={{ flex: 1 }}>
            <VText variant="title">Circles</VText>
            <VText variant="caption" muted>
              A Circle does two jobs: it decides who can see a post, and it decides how highly those
              people rank in your feed.
            </VText>
          </View>
        </View>

        {circles.map((cc) => {
          const open = expanded === cc.id;
          return (
            <Animated.View
              key={cc.id}
              layout={LinearTransition.springify().damping(20)}
              style={[styles.card, { borderColor: open ? cc.color : c.border, backgroundColor: c.surface }]}
            >
              <Touchable
                onPress={() => setExpanded(open ? null : cc.id)}
                feedback="light"
                accessibilityLabel={`${cc.name}, ${cc.memberIds.length} members`}
                accessibilityState={{ expanded: open }}
                style={styles.cardHead}
              >
                <View style={[styles.icon, { backgroundColor: cc.color }]}>
                  <Icon name={cc.glyph as any} size={17} color="#08080C" />
                </View>
                <View style={{ flex: 1 }}>
                  <VText variant="subheading">{cc.name}</VText>
                  <VText variant="caption" muted>
                    {cc.memberIds.length} {cc.memberIds.length === 1 ? 'person' : 'people'} · feed
                    boost {cc.boost >= 0 ? '+' : ''}
                    {cc.boost.toFixed(2)}
                  </VText>
                </View>
                <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={c.textMuted} />
              </Touchable>

              {open ? (
                <Animated.View entering={FadeIn.duration(200)} style={{ gap: space.base }}>
                  <Slider
                    label="How much this Circle outranks everyone else"
                    value={cc.boost}
                    onChange={(v) => setCircleBoost(cc.id, v)}
                    tone={cc.color}
                    leftLabel="Same as anyone"
                    rightLabel="Straight to the top"
                  />

                  {/*
                    This used to list every account in the app with a tick beside
                    it, which only worked while "every account" was eight seeded
                    people. Adding someone is now a search — so this shows who is
                    actually in the circle, and sends you to the directory to
                    change that.
                  */}
                  <View style={{ gap: space.sm }}>
                    <VText variant="label" secondary>
                      Members
                    </VText>

                    {cc.memberIds.map((id) => (
                      <MemberRow
                        key={id}
                        id={id}
                        color={cc.color}
                        onRemove={() => toggleCircleMember(cc.id, id)}
                      />
                    ))}

                    {!cc.memberIds.length ? (
                      <VText variant="caption" muted>
                        Nobody in this circle yet.
                      </VText>
                    ) : null}

                    <Chip
                      label="Add people"
                      glyph="plus"
                      onPress={() => router.push('/people')}
                    />
                  </View>
                </Animated.View>
              ) : null}
            </Animated.View>
          );
        })}

        <View style={{ gap: space.md }}>
          <SectionHeader title="Add a Circle" subtitle="Start with a name, add people later" />
          <View style={styles.presets}>
            {NEW_CIRCLE_PRESETS.filter((p) => !circles.some((cc) => cc.name === p.name)).map((p) => (
              <Chip
                key={p.name}
                label={p.name}
                glyph="plus"
                tone={p.color}
                onPress={() => addCircle(p.name, p.color, p.glyph)}
              />
            ))}
          </View>
        </View>
      </ScrollView>
      <TopScrim />
    </View>
  );
}

/**
 * One person in a circle.
 *
 * Reads the profile out of the store rather than taking it as a prop, because
 * the id is the only thing a circle actually stores about its members — the
 * name and picture are looked up wherever they are needed.
 */
function MemberRow({
  id,
  color,
  onRemove,
}: {
  id: string;
  color: string;
  onRemove: () => void;
}) {
  const { c } = useTheme();
  const author = useAuthor(id);

  return (
    <View style={styles.member}>
      <Avatar uri={author?.avatar ?? ''} size={36} ring={color} />
      <View style={{ flex: 1 }}>
        <VText variant="callout">{author?.name ?? 'Someone you added'}</VText>
        <VText variant="caption" muted>
          {author?.handle ? `@${author.handle}` : 'Profile not loaded'}
        </VText>
      </View>
      <Touchable
        onPress={onRemove}
        feedback="select"
        hitSlop={10}
        accessibilityLabel={`Remove ${author?.name ?? 'this person'} from the circle`}
        style={[styles.check, { borderColor: c.borderStrong }]}
      >
        <Icon name="x" size={14} color={c.textSecondary} />
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.base,
    gap: space.base,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  icon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  member: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
