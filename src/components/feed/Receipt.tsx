import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Chip, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { duration, space } from '@/theme/tokens';
import type { ScoreReceipt } from '@/data/types';
import { TOPIC_BY_ID } from '@/data/topics';
import { useVybe } from '@/store/useVybe';

const BAR_WIDTH = 96;

/**
 * "Why am I seeing this" — the receipt.
 *
 * This is not a post-hoc explanation: the factors shown here are the exact
 * terms the engine summed to place this post. Every line is actionable, so
 * reading the receipt and changing the algorithm are the same gesture.
 */
export function Receipt({
  receipt,
  authorId,
  compact,
}: {
  receipt: ScoreReceipt;
  authorId: string;
  compact?: boolean;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const rotate = useSharedValue(0);

  const chevron = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value * 180}deg` }],
  }));

  const setTopicWeight = useVybe((s) => s.setTopicWeight);
  const nudgeAuthor = useVybe((s) => s.nudgeAuthor);
  const addMode = useVybe((s) => s.addMode);
  const weights = useVybe((s) => s.algo.topicWeights);

  const chronological = receipt.factors[0]?.key === 'chronological';
  const maxAbs = Math.max(0.15, ...receipt.factors.map((f) => Math.abs(f.contribution)));

  const toggle = () => {
    haptic('light');
    const next = !open;
    setOpen(next);
    rotate.value = withTiming(next ? 1 : 0, { duration: duration.base });
  };

  return (
    <Animated.View layout={LinearTransition.springify().damping(20)}>
      <Touchable
        onPress={toggle}
        feedback="none"
        scaleTo={0.995}
        accessibilityRole="button"
        accessibilityLabel={`Why am I seeing this. ${receipt.headline}. Double tap to ${open ? 'collapse' : 'expand'} the score breakdown.`}
        style={[
          styles.strip,
          {
            backgroundColor: open ? c.surfaceElevated : c.bgSubtle,
            borderColor: open ? c.borderStrong : c.border,
          },
        ]}
      >
        <View style={[styles.rankBadge, { backgroundColor: chronological ? c.cyan : c.accentDim }]}>
          <VText
            variant="micro"
            color={chronological ? c.onAccent : c.accent}
          >
            {chronological ? 'RAW' : `#${receipt.rank}`}
          </VText>
        </View>

        <VText variant="caption" secondary numberOfLines={1} style={{ flex: 1 }}>
          {receipt.headline}
        </VText>

        {!chronological && !compact ? (
          <VText variant="numeric" color={receipt.total >= 0 ? c.primary : c.ember}>
            {receipt.total >= 0 ? '+' : ''}
            {receipt.total.toFixed(2)}
          </VText>
        ) : null}

        <Animated.View style={chevron}>
          <Icon name="chevron-down" size={16} color={c.textMuted} />
        </Animated.View>
      </Touchable>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(duration.base)}
          exiting={FadeOut.duration(duration.fast)}
          style={[styles.panel, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}
        >
          <VText variant="micro" muted style={{ marginBottom: space.md }}>
            {chronological ? 'NO RANKING APPLIED' : 'EVERY TERM THAT MOVED THIS POST'}
          </VText>

          {receipt.factors.map((f) => {
            const positive = f.contribution >= 0;
            const w = (Math.abs(f.contribution) / maxAbs) * (BAR_WIDTH / 2);
            return (
              <View key={f.key} style={styles.row}>
                <View style={styles.barTrack}>
                  <View style={[styles.zeroLine, { backgroundColor: c.borderStrong }]} />
                  <View
                    style={[
                      styles.bar,
                      {
                        width: Math.max(w, chronological ? 0 : 2),
                        backgroundColor: positive ? c.primary : c.ember,
                        left: positive ? BAR_WIDTH / 2 : BAR_WIDTH / 2 - Math.max(w, 2),
                      },
                    ]}
                  />
                </View>

                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.factorHead}>
                    <VText variant="label">{f.label}</VText>
                    {!chronological ? (
                      <VText variant="numeric" color={positive ? c.primary : c.ember}>
                        {positive ? '+' : ''}
                        {f.contribution.toFixed(2)}
                      </VText>
                    ) : null}
                  </View>
                  <VText variant="caption" muted>
                    {f.because}
                  </VText>
                  {!chronological ? (
                    <VText variant="micro" muted style={{ opacity: 0.7 }}>
                      signal {f.signal.toFixed(2)} × your weight {f.weight.toFixed(2)}
                    </VText>
                  ) : null}
                </View>
              </View>
            );
          })}

          {!chronological ? (
            <>
              <View style={[styles.totalRow, { borderTopColor: c.divider }]}>
                <VText variant="label" secondary>
                  Total score
                </VText>
                <VText variant="numeric" color={receipt.total >= 0 ? c.primary : c.ember}>
                  {receipt.total >= 0 ? '+' : ''}
                  {receipt.total.toFixed(3)}
                </VText>
              </View>

              <VText variant="micro" muted style={{ marginBottom: space.sm }}>
                CHANGE IT FROM HERE
              </VText>
              <View style={styles.actions}>
                {receipt.factors
                  .filter((f) => f.actionableTopic)
                  .slice(0, 1)
                  .map((f) => {
                    const t = TOPIC_BY_ID[f.actionableTopic!];
                    const current = weights[f.actionableTopic!] ?? 0;
                    return (
                      <React.Fragment key={f.actionableTopic}>
                        <Chip
                          size="sm"
                          glyph="chevron-up"
                          label={`More ${t?.label ?? ''}`}
                          onPress={() =>
                            setTopicWeight(f.actionableTopic!, current + 0.2, 'receipt')
                          }
                        />
                        <Chip
                          size="sm"
                          glyph="chevron-down"
                          label={`Less ${t?.label ?? ''}`}
                          onPress={() =>
                            setTopicWeight(f.actionableTopic!, current - 0.2, 'receipt')
                          }
                        />
                        <Chip
                          size="sm"
                          glyph="clock"
                          label="Mute 7 days"
                          onPress={() =>
                            addMode({
                              label: `Less ${t?.label ?? 'this'}`,
                              topicId: f.actionableTopic!,
                              delta: -0.6,
                              expiresAt: Date.now() + 7 * 86_400_000,
                            })
                          }
                        />
                      </React.Fragment>
                    );
                  })}
                <Chip
                  size="sm"
                  glyph="user-minus"
                  label="Less from them"
                  onPress={() => nudgeAuthor(authorId, -0.25, 'receipt')}
                />
              </View>
            </>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 8,
    paddingHorizontal: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  rankBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  panel: {
    marginTop: space.sm,
    padding: space.base,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    marginBottom: space.md,
  },
  barTrack: {
    width: BAR_WIDTH,
    height: 20,
    justifyContent: 'center',
    marginTop: 2,
  },
  zeroLine: {
    position: 'absolute',
    left: BAR_WIDTH / 2,
    width: StyleSheet.hairlineWidth,
    top: 0,
    bottom: 0,
  },
  bar: {
    position: 'absolute',
    height: 8,
  },
  factorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.md,
    marginBottom: space.base,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});
