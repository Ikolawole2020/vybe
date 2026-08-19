import React, { useMemo } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Icon, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius as RAD, space, spring } from '@/theme/tokens';
import type { Boundary, Circle as CircleT } from '@/data/types';

const SIZE = Math.min(Dimensions.get('window').width - space.base * 2, 340);
const CX = SIZE / 2;
const CY = SIZE / 2;
const R0 = 26;

export type Level = { id: string; name: string; color: string; glyph: string };

/**
 * The Boundaries dial.
 *
 * Reach is drawn as distance: the tighter the ring, the fewer people. Two
 * handles ride the same spoke — an outer one for who can *see* the post and an
 * inner one for who can *reply* — because those are genuinely different
 * questions and every other network collapses them into one.
 *
 * The inner handle can never pass the outer one, so an impossible boundary
 * ("only close friends can see it, but everyone can comment") cannot be
 * expressed.
 */
export function BoundaryDial({
  circles,
  value,
  onChange,
}: {
  circles: CircleT[];
  value: Boundary;
  onChange: (b: Boundary) => void;
}) {
  const { c } = useTheme();

  const levels: Level[] = useMemo(
    () => [
      { id: '__me', name: 'Only me', color: c.textMuted, glyph: 'lock' },
      ...circles.map((cc) => ({ id: cc.id, name: cc.name, color: cc.color, glyph: cc.glyph })),
      { id: 'public', name: 'Everyone', color: c.accent, glyph: 'globe' },
    ],
    [circles, c],
  );

  const step = (SIZE / 2 - R0 - 22) / Math.max(levels.length - 1, 1);
  const rFor = (i: number) => R0 + i * step;

  const viewIdx = Math.max(
    0,
    levels.findIndex((l) => value.visibleTo.includes(l.id)),
  );
  const interactIdx = Math.max(
    0,
    levels.findIndex((l) => value.canInteract.includes(l.id)),
  );

  const commit = (kind: 'view' | 'interact', idx: number) => {
    const id = levels[idx].id;
    if (kind === 'view') {
      const nextInteract = Math.min(interactIdx, idx);
      onChange({ visibleTo: [id], canInteract: [levels[nextInteract].id] });
    } else {
      onChange({ visibleTo: [levels[viewIdx].id], canInteract: [levels[Math.min(idx, viewIdx)].id] });
    }
  };

  return (
    <View style={{ gap: space.base }}>
      <View style={{ width: SIZE, height: SIZE, alignSelf: 'center' }}>
        <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
          {levels.map((l, i) => (
            <Circle
              key={l.id}
              cx={CX}
              cy={CY}
              r={rFor(i)}
              stroke={i <= viewIdx ? l.color : c.border}
              strokeOpacity={i <= viewIdx ? 0.55 : 1}
              strokeWidth={i === viewIdx ? 2 : 1}
              strokeDasharray={i > viewIdx ? '4 6' : undefined}
              fill="none"
            />
          ))}
          {/* Labels stack up the top spoke; the handles ride the bottom one so
              the two never sit on top of each other. */}
          <Line x1={CX} y1={CY} x2={CX} y2={CY + rFor(levels.length - 1)} stroke={c.divider} strokeWidth={1} />
        </Svg>

        <View style={[styles.core, { backgroundColor: c.surfaceElevated, borderColor: c.borderStrong }]}>
          <Icon name="edit-3" size={16} color={c.text} />
        </View>

        {levels.map((l, i) => (
          <View
            key={l.id}
            pointerEvents="none"
            style={[
              styles.ringLabel,
              { top: CY - rFor(i) - 8, left: CX + 10 },
            ]}
          >
            <VText
              variant="micro"
              style={{ fontSize: 8.5, letterSpacing: 0 }}
              color={i <= viewIdx ? l.color : c.textMuted}
              numberOfLines={1}
            >
              {l.name}
            </VText>
          </View>
        ))}

        <Handle
          kind="view"
          levels={levels}
          index={viewIdx}
          rMin={R0}
          step={step}
          tone={c.primary}
          glyph="eye"
          onCommit={(i) => commit('view', i)}
          maxIndex={levels.length - 1}
        />
        <Handle
          kind="interact"
          levels={levels}
          index={interactIdx}
          rMin={R0}
          step={step}
          tone={c.cyan}
          glyph="message-circle"
          onCommit={(i) => commit('interact', i)}
          maxIndex={viewIdx}
          offsetX={-40}
        />
      </View>

      <View style={styles.summary}>
        <SummaryLine
          glyph="eye"
          tone={c.primary}
          label="Can see"
          value={levels[viewIdx]?.name ?? 'Everyone'}
        />
        <SummaryLine
          glyph="message-circle"
          tone={c.cyan}
          label="Can reply"
          value={levels[interactIdx]?.name ?? 'Everyone'}
        />
      </View>
    </View>
  );
}

function Handle({
  levels,
  index,
  rMin,
  step,
  tone,
  glyph,
  onCommit,
  maxIndex,
  offsetX = 0,
}: {
  kind: 'view' | 'interact';
  levels: Level[];
  index: number;
  /** Radius of level 0. Passed as a number, not a function — gesture callbacks
   *  run on the UI runtime and cannot reach back into JS closures. */
  rMin: number;
  step: number;
  tone: string;
  glyph: React.ComponentProps<typeof Icon>['name'];
  onCommit: (i: number) => void;
  maxIndex: number;
  offsetX?: number;
}) {
  const { c } = useTheme();
  const y = useSharedValue(rMin + index * step);
  const start = useSharedValue(0);
  const dragging = useSharedValue(0);

  React.useEffect(() => {
    if (dragging.value === 0) y.value = withSpring(rMin + index * step, spring.gentle);
  }, [index, rMin, step, y, dragging]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      dragging.value = 1;
      start.value = y.value;
      runOnJS(haptic)('light');
    })
    .onUpdate((e) => {
      // Handles sit below the core, so dragging down moves outward — toward
      // more people.
      const lo = rMin;
      const hi = rMin + maxIndex * step;
      y.value = Math.max(lo, Math.min(hi, start.value + e.translationY));
    })
    .onEnd(() => {
      dragging.value = 0;
      const i = Math.max(0, Math.min(maxIndex, Math.round((y.value - rMin) / step)));
      y.value = withSpring(rMin + i * step, spring.gentle);
      runOnJS(onCommit)(i);
      runOnJS(haptic)('select');
    });

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: CX - 19 + offsetX },
      { translateY: CY + y.value - 19 },
      { scale: 1 + dragging.value * 0.15 },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.handle, { backgroundColor: tone, borderColor: c.bg }, style]}
        accessibilityRole="adjustable"
        accessibilityLabel={`${glyph === 'eye' ? 'Who can see' : 'Who can reply'}: ${levels[index]?.name}`}
      >
        <Icon name={glyph} size={17} color={c.bg} />
      </Animated.View>
    </GestureDetector>
  );
}

function SummaryLine({
  glyph,
  tone,
  label,
  value,
}: {
  glyph: React.ComponentProps<typeof Icon>['name'];
  tone: string;
  label: string;
  value: string;
}) {
  const { c } = useTheme();
  return (
    <View style={[styles.summaryLine, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={[styles.summaryIcon, { backgroundColor: tone }]}>
        <Icon name={glyph} size={13} color={c.bg} />
      </View>
      <VText variant="caption" muted style={{ flex: 1 }}>
        {label}
      </VText>
      <VText variant="label">{value}</VText>
    </View>
  );
}

const styles = StyleSheet.create({
  core: {
    position: 'absolute',
    left: CX - 20,
    top: CY - 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  ringLabel: { position: 'absolute', maxWidth: 110 },
  handle: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
  },
  summary: { gap: space.sm },
  summaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: RAD.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  summaryIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
