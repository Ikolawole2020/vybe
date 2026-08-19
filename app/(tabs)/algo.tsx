import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { TopScrim } from '@/components/TopScrim';
import { Block } from '@/components/ui/Surface';
import { Reveal } from '@/components/ui/Reveal';
import { ScreenTitle } from '@/components/ui/ScreenTitle';
import { Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { TAB_BAR_CLEARANCE } from '@/components/nav/LiquidTabBar';
import { TOPICS } from '@/data/topics';
import { SETUP_PRESETS, matchPreset, useVybe, type SetupPreset } from '@/store/useVybe';
import type { TopicId } from '@/data/types';

/** Above this counts as "more of this", below its negative as "less of this". */
const EDGE = 0.05;
const MORE = 0.75;
const LESS = -0.6;

/**
 * Your feed, in three questions.
 *
 * This screen used to show the engine: six named dials, a draggable weight
 * constellation, and every topic as a signed number. All of it was true and
 * none of it was legible — the first thing anyone asked was what it meant.
 *
 * So the surface now asks only what a person can answer about themselves — more
 * of what, less of what, and how adventurous it should be — in the same words
 * setup used, because that is the one vocabulary the user has already met. The
 * dials still exist and still run the ranking; they live behind Advanced, where
 * wanting to see the arithmetic is the reason you are there.
 */
export default function AlgoScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const weights = useVybe((s) => s.algo.topicWeights);
  const dials = useVybe((s) => s.algo.dials);
  const setTopicWeight = useVybe((s) => s.setTopicWeight);
  const applyPreset = useVybe((s) => s.applyPreset);

  const preset = matchPreset(dials);

  const more = useMemo(() => TOPICS.filter((t) => (weights[t.id] ?? 0) > EDGE), [weights]);
  const less = useMemo(() => TOPICS.filter((t) => (weights[t.id] ?? 0) < -EDGE), [weights]);
  const spare = useMemo(
    () => TOPICS.filter((t) => Math.abs(weights[t.id] ?? 0) <= EDGE),
    [weights],
  );

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + space.xxl,
          paddingHorizontal: space.gutter,
          gap: space.xl,
        }}
      >
        <Reveal index={0}>
          <ScreenTitle
            title="Your feed"
            subtitle="You decide what turns up here. Change any of it whenever you like — it takes effect straight away."
          />
        </Reveal>

        <Reveal index={1}>
          <TopicPicker
            title="Show me more"
            blurb="These get lifted toward the top."
            tone={c.volt}
            chosen={more}
            spare={spare}
            onAdd={(id) => setTopicWeight(id, MORE, 'panel')}
            onRemove={(id) => setTopicWeight(id, 0, 'panel')}
            empty="Nothing picked yet. Add a few things you actually want to see."
          />
        </Reveal>

        <Reveal index={2}>
          <TopicPicker
            title="Show me less"
            blurb="Pushed down, never blocked. You will still see the odd one."
            tone={c.ember}
            chosen={less}
            spare={spare}
            onAdd={(id) => setTopicWeight(id, LESS, 'panel')}
            onRemove={(id) => setTopicWeight(id, 0, 'panel')}
            empty="Nothing turned down. Add anything you would rather see less of."
          />
        </Reveal>

        <Reveal index={3} style={{ gap: space.md }}>
          <View style={{ gap: 4 }}>
            <VText variant="heading">How adventurous?</VText>
            <VText variant="caption" secondary>
              How far the feed goes beyond what you already picked.
            </VText>
          </View>

          {(Object.keys(SETUP_PRESETS) as SetupPreset[]).map((key) => (
            <FeelCard
              key={key}
              id={key}
              active={preset === key}
              onPress={() => {
                haptic('select');
                applyPreset(key);
              }}
            />
          ))}

          {preset === null ? (
            <Animated.View entering={FadeIn}>
              <Block style={styles.note}>
                <Icon name="sliders" size={15} color={c.textMuted} />
                <VText variant="caption" muted style={{ flex: 1 }}>
                  Your settings have been adjusted by hand in Advanced, so none of these three
                  matches. Picking one will replace them.
                </VText>
              </Block>
            </Animated.View>
          ) : null}
        </Reveal>

        <Reveal index={4}>
          <Touchable
            onPress={() => router.push('/algo-advanced')}
            feedback="light"
            accessibilityLabel="Advanced settings"
            style={[styles.advanced, { borderColor: c.border }]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <VText variant="subheading">Advanced</VText>
              <VText variant="caption" muted>
                The six numbers behind all of this, every topic as a slider, timed boosts, your
                daily limit, and the full history of changes.
              </VText>
            </View>
            <Icon name="chevron-right" size={18} color={c.textMuted} />
          </Touchable>
        </Reveal>
      </ScrollView>
      <TopScrim />
    </View>
  );
}

/**
 * A list of chosen topics plus the ones still going spare.
 *
 * Adding and removing are the same gesture in two places rather than a
 * three-state toggle — "tap once for more, twice for less, three times for
 * neutral" is exactly the kind of cleverness that made the old screen unusable.
 */
function TopicPicker({
  title,
  blurb,
  tone,
  chosen,
  spare,
  onAdd,
  onRemove,
  empty,
}: {
  title: string;
  blurb: string;
  tone: string;
  chosen: typeof TOPICS;
  spare: typeof TOPICS;
  onAdd: (id: TopicId) => void;
  onRemove: (id: TopicId) => void;
  empty: string;
}) {
  const { c } = useTheme();
  const [adding, setAdding] = useState(false);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 4 }}>
        <VText variant="heading">{title}</VText>
        <VText variant="caption" secondary>
          {blurb}
        </VText>
      </View>

      <Animated.View layout={LinearTransition.springify()} style={styles.chips}>
        {chosen.map((t) => (
          <Animated.View key={t.id} entering={FadeIn} exiting={FadeOut}>
            <Chip
              label={t.label}
              glyph="x"
              tone={tone}
              active
              onPress={() => {
                haptic('light');
                onRemove(t.id);
              }}
            />
          </Animated.View>
        ))}

        {spare.length ? (
          <Chip
            label={adding ? 'Done' : 'Add'}
            glyph={adding ? 'check' : 'plus'}
            onPress={() => setAdding((v) => !v)}
          />
        ) : null}
      </Animated.View>

      {chosen.length === 0 && !adding ? (
        <VText variant="caption" muted>
          {empty}
        </VText>
      ) : null}

      {adding ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.chips}>
          {spare.map((t) => (
            <Chip
              key={t.id}
              size="sm"
              label={t.label}
              onPress={() => {
                haptic('select');
                onAdd(t.id);
              }}
            />
          ))}
        </Animated.View>
      ) : null}

      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
    </View>
  );
}

/** One temperament, as a sentence rather than a dial set. */
function FeelCard({
  id,
  active,
  onPress,
}: {
  id: SetupPreset;
  active: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const p = SETUP_PRESETS[id];

  return (
    <Touchable
      onPress={onPress}
      feedback="none"
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${p.label}. ${p.blurb}`}
      style={[
        styles.feel,
        {
          backgroundColor: active ? c.volt : c.surfaceElevated,
          borderColor: active ? c.volt : c.border,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <VText variant="subheading" color={active ? c.onVolt : c.text}>
          {p.label}
        </VText>
        <VText
          variant="caption"
          color={active ? c.onVolt : c.textSecondary}
          style={active ? { opacity: 0.75 } : undefined}
        >
          {p.blurb}
        </VText>
      </View>
      {active ? <Icon name="check" size={19} color={c.onVolt} /> : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  feel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    minHeight: 68,
  },
  advanced: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
