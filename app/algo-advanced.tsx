import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { AmbientAura } from '@/components/AmbientAura';
import { TopScrim } from '@/components/TopScrim';
import { Block } from '@/components/ui/Surface';
import { Reveal } from '@/components/ui/Reveal';
import { SectionHead } from '@/components/ui/ScreenTitle';
import { FeedGenome } from '@/components/algo/FeedGenome';
import { Slider } from '@/components/ui/Slider';
import { Button, Chip, Divider, Icon, Touchable, VText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { alpha, space } from '@/theme/tokens';
import { DIAL_META, activeModes, fmtAge } from '@/algo/engine';
import { TOPICS } from '@/data/topics';
import { useVybe } from '@/store/useVybe';
import type { AlgoDials } from '@/data/types';

export default function AlgoAdvancedScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const algo = useVybe((s) => s.algo);
  const setTopicWeight = useVybe((s) => s.setTopicWeight);
  const setDial = useVybe((s) => s.setDial);
  const resetAlgo = useVybe((s) => s.resetAlgo);

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.base,
          paddingBottom: 140,
          paddingHorizontal: space.gutter,
        }}
      >
        {/* Main container with clean vertical gap between all sections */}
        <View style={{ gap: space.xl }}>
          
          <Reveal index={0} style={{ gap: space.md }}>
            <Touchable
              onPress={() => goBack()}
              feedback="light"
              hitSlop={10}
              accessibilityLabel="Back"
              style={styles.back}
            >
              <Icon name="arrow-left" size={20} color={c.text} />
              <VText variant="label" secondary>
                Your feed
              </VText>
            </Touchable>

            <VText variant="hero">Advanced</VText>
            <VText variant="body" secondary>
              These are the actual numbers the ranking uses. Nothing here is hidden or inferred, and
              nothing else touches your feed.
            </VText>
          </Reveal>

          <Reveal index={1} style={{ gap: space.md }}>
            <SectionHead flush label="The six dials" note="What each signal is worth" />
            <View style={{ gap: space.md }}>
              {DIAL_META.map((d) => (
                <Block key={d.key} style={styles.card}>
                  <Slider
                    label={d.label}
                    value={algo.dials[d.key as keyof AlgoDials]}
                    onChange={(v) => setDial(d.key as keyof AlgoDials, v)}
                    tone={d.key === 'crowd' ? c.warning : c.accent}
                    leftLabel={d.low}
                    rightLabel={d.high}
                    hint={d.blurb}
                  />
                </Block>
              ))}
            </View>
          </Reveal>

          <Reveal index={2} style={{ gap: space.md }}>
            <SectionHead flush label="Every topic" note="The weight applied to each one" />
            <View style={{ gap: space.md }}>
              {TOPICS.map((t) => (
                <Block key={t.id} style={styles.card}>
                  <View style={styles.topicHead}>
                    <View
                      style={[styles.topicIcon, { borderColor: t.hue, backgroundColor: alpha(t.hue, 0.12) }]}
                    >
                      <Icon name={t.glyph as any} size={15} color={t.hue} />
                    </View>
                    <Slider
                      label={t.label}
                      value={algo.topicWeights[t.id] ?? 0}
                      onChange={(v) => setTopicWeight(t.id, v, 'panel')}
                      bipolar
                      tone={t.hue}
                      leftLabel="Show me fewer"
                      rightLabel="Show me more"
                    />
                  </View>
                </Block>
              ))}
            </View>
          </Reveal>

          <Reveal index={3} style={{ gap: space.md }}>
            <SectionHead
              flush
              label="Constellation"
              note="Drag a topic to the centre to see more of it"
            />
            <FeedGenome />
          </Reveal>

          <TemporaryModes />

          <AttentionBudgetCard />

          <View style={{ gap: space.md }}>
            <SectionHead flush label="History" note="Every change you have made, reversible" />
            <View style={{ gap: space.sm }}>
              <Button
                label="Open the algorithm ledger"
                glyph="list"
                variant="ghost"
                onPress={() => router.push('/ledger')}
              />
              <Button
                label="Reset everything to neutral"
                glyph="trash-2"
                variant="ghost"
                onPress={resetAlgo}
              />
            </View>
          </View>

        </View>
      </ScrollView>
      <TopScrim />
    </View>
  );
}

/** Time-boxed overrides with a live countdown, so nothing you set is forever. */
function TemporaryModes() {
  const { c } = useTheme();
  const algo = useVybe((s) => s.algo);
  const addMode = useVybe((s) => s.addMode);
  const removeMode = useVybe((s) => s.removeMode);
  const [picking, setPicking] = useState(false);

  const modes = activeModes(algo);

  return (
    <View style={{ gap: space.md }}>
      <SectionHead
        flush
        label="Timed boosts"
        note="Lift something for a while, then have it expire on its own"
        action={
          <Chip
            label={picking ? 'Cancel' : 'New'}
            glyph={picking ? 'x' : 'plus'}
            onPress={() => setPicking((p) => !p)}
          />
        }
      />

      <View style={{ gap: space.md }}>
        {picking ? (
          <Animated.View entering={FadeIn} style={styles.picker}>
            {TOPICS.map((t) => (
              <Chip
                key={t.id}
                size="sm"
                label={`+ ${t.label} · 3d`}
                tone={t.hue}
                onPress={() => {
                  addMode({
                    label: `More ${t.label}`,
                    topicId: t.id,
                    delta: 0.6,
                    expiresAt: Date.now() + 3 * 86_400_000,
                  });
                  setPicking(false);
                }}
              />
            ))}
          </Animated.View>
        ) : null}

        {modes.length === 0 && !picking ? (
          <Block style={styles.note}>
            <Icon name="clock" size={15} color={c.textMuted} />
            <VText variant="caption" muted style={{ flex: 1 }}>
              Nothing timed is running. A boost set today is gone by itself on the day it expires —
              you never have to remember to undo it.
            </VText>
          </Block>
        ) : null}
      </View>

      {modes.map((m) => {
        const total = m.expiresAt - m.startedAt;
        const left = m.expiresAt - Date.now();
        const p = Math.max(0, Math.min(1, 1 - left / total));
        return (
          <Animated.View key={m.id} layout={LinearTransition}>
            <Block accent={m.delta > 0 ? c.primary : c.ember} style={styles.mode}>
              <ExpiryRing progress={p} tone={m.delta > 0 ? c.primary : c.ember} />
              <View style={{ flex: 1 }}>
                <VText variant="subheading">{m.label}</VText>
                <VText variant="caption" muted>
                  {fmtAge(left / 3600_000)} left · {m.delta > 0 ? '+' : ''}
                  {m.delta.toFixed(2)} applied on top of your slider
                </VText>
              </View>
              <Touchable
                onPress={() => removeMode(m.id)}
                feedback="light"
                hitSlop={10}
                accessibilityLabel={`End ${m.label} now`}
              >
                <Icon name="x" size={18} color={c.textMuted} />
              </Touchable>
            </Block>
          </Animated.View>
        );
      })}
    </View>
  );
}

function ExpiryRing({ progress, tone }: { progress: number; tone: string }) {
  const { c } = useTheme();
  const size = 38;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * progress}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Icon name="clock" size={14} color={tone} />
    </View>
  );
}

function AttentionBudgetCard() {
  const { c } = useTheme();
  const budget = useVybe((s) => s.budget);
  const setBudget = useVybe((s) => s.setBudget);

  return (
    <View style={{ gap: space.md }}>
      <SectionHead
        flush
        label="Daily limit"
        note="The one number this app tries to make smaller"
        action={
          <Chip
            label={budget.enabled ? 'On' : 'Off'}
            glyph={budget.enabled ? 'check' : 'x'}
            active={budget.enabled}
            onPress={() => setBudget({ enabled: !budget.enabled })}
          />
        }
      />
      <Block style={styles.card}>
        <Slider
          label="Daily limit"
          value={budget.limitMinutes / 120}
          onChange={(v) => setBudget({ limitMinutes: Math.max(5, Math.round((v * 120) / 5) * 5) })}
          tone={c.warning}
          format={() => `${budget.limitMinutes} min`}
          leftLabel="5 min"
          rightLabel="2 hours"
        />
        <Divider />
        <View style={styles.budgetRow}>
          <VText variant="caption" muted style={{ flex: 1 }}>
            Spent today: {Math.round(budget.spentSeconds / 60)} min. Past the limit the feed keeps
            working but stops being colourful — no lockout, no shame screen.
          </VText>
          <Touchable
            onPress={() => setBudget({ spentSeconds: 0 })}
            feedback="light"
            accessibilityLabel="Reset today's usage"
          >
            <Icon name="rotate-ccw" size={16} color={c.textMuted} />
          </Touchable>
        </View>
      </Block>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  card: { padding: space.base, gap: space.md },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  topicHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  topicIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  mode: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.base },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});