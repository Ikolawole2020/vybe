import React, { useCallback } from 'react';
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
import { radius as R, space, spring } from '@/theme/tokens';
import { TOPICS } from '@/data/topics';
import { useVybe } from '@/store/useVybe';

const SIZE = Math.min(Dimensions.get('window').width - space.base * 2, 380);
const CENTER = SIZE / 2;
const R_MAX = CENTER - 40;
// Fully-boosted nodes still need to clear the core and each other, so the
// inner ring sits well outside the centre rather than collapsing onto it.
const R_MIN = 78;

/** weight (+1 … -1) → distance from centre. Pulled in means turned up. */
function weightToRadius(w: number) {
  return R_MIN + ((1 - w) / 2) * (R_MAX - R_MIN);
}
function radiusToWeight(r: number) {
  'worklet';
  const clamped = Math.max(R_MIN, Math.min(R_MAX, r));
  return 1 - ((clamped - R_MIN) / (R_MAX - R_MIN)) * 2;
}

/**
 * The Feed Genome.
 *
 * The same numbers as the sliders below it, but spatial: you are the centre,
 * and every topic sits at a distance you set by dragging. Pull something in
 * and you will see more of it. Push it to the rim and it fades out.
 *
 * This exists because a column of sliders never shows you the *shape* of your
 * own attention — which three things you have pulled close, and how much
 * everything else is orbiting at arm's length.
 */
export function FeedGenome() {
  const { c } = useTheme();
  const weights = useVybe((s) => s.algo.topicWeights);
  const setTopicWeight = useVybe((s) => s.setTopicWeight);

  const commit = useCallback(
    (id: string, w: number) => setTopicWeight(id, w, 'genome'),
    [setTopicWeight],
  );

  return (
    <View style={{ width: SIZE, height: SIZE, alignSelf: 'center' }}>
      <Svg width={SIZE} height={SIZE} style={StyleSheet.absoluteFill}>
        {[R_MIN, (R_MIN + R_MAX) / 2, R_MAX].map((r, i) => (
          <Circle
            key={r}
            cx={CENTER}
            cy={CENTER}
            r={r}
            stroke={i === 1 ? c.borderStrong : c.border}
            strokeWidth={1}
            strokeDasharray={i === 1 ? '3 5' : undefined}
            fill="none"
          />
        ))}
        {TOPICS.map((t, i) => {
          const a = (i / TOPICS.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <Line
              key={t.id}
              x1={CENTER}
              y1={CENTER}
              x2={CENTER + Math.cos(a) * R_MAX}
              y2={CENTER + Math.sin(a) * R_MAX}
              stroke={c.divider}
              strokeWidth={1}
            />
          );
        })}
      </Svg>

      <View style={[styles.core, { backgroundColor: c.text, borderColor: c.bg }]}>
        <Icon name="zap" size={17} color={c.bg} />
        <VText variant="micro" color={c.bg} style={{ fontSize: 8.5, letterSpacing: 0.4 }}>
          YOU
        </VText>
      </View>

      {TOPICS.map((t, i) => (
        <GenomeNode
          key={t.id}
          index={i}
          count={TOPICS.length}
          topicId={t.id}
          label={t.label}
          glyph={t.glyph as any}
          hue={t.hue}
          weight={weights[t.id] ?? 0}
          onCommit={commit}
        />
      ))}
    </View>
  );
}

function GenomeNode({
  index,
  count,
  topicId,
  label,
  glyph,
  hue,
  weight,
  onCommit,
}: {
  index: number;
  count: number;
  topicId: string;
  label: string;
  glyph: React.ComponentProps<typeof Icon>['name'];
  hue: string;
  weight: number;
  onCommit: (id: string, w: number) => void;
}) {
  const { c } = useTheme();
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  const dist = useSharedValue(weightToRadius(weight));
  const start = useSharedValue(0);
  const active = useSharedValue(0);

  // Re-sync when the value changes from elsewhere (sliders, Dear Algo, undo).
  React.useEffect(() => {
    if (active.value === 0) dist.value = withSpring(weightToRadius(weight), spring.gentle);
  }, [weight, dist, active]);

  const pan = Gesture.Pan()
    .onBegin(() => {
      active.value = 1;
      start.value = dist.value;
      runOnJS(haptic)('light');
    })
    .onUpdate((e) => {
      // Project the drag onto the topic's own spoke so nodes stay on their axis.
      const along = e.translationX * Math.cos(angle) + e.translationY * Math.sin(angle);
      dist.value = Math.max(R_MIN, Math.min(R_MAX, start.value + along));
    })
    .onEnd(() => {
      active.value = 0;
      const w = radiusToWeight(dist.value);
      runOnJS(onCommit)(topicId, Math.round(w * 20) / 20);
      runOnJS(haptic)('select');
    });

  const nodeStyle = useAnimatedStyle(() => {
    const w = radiusToWeight(dist.value);
    return {
      transform: [
        { translateX: CENTER + Math.cos(angle) * dist.value - 27 },
        { translateY: CENTER + Math.sin(angle) * dist.value - 27 },
        { scale: (0.78 + ((w + 1) / 2) * 0.42) * (1 + active.value * 0.12) },
      ],
      opacity: 0.42 + ((w + 1) / 2) * 0.58,
    };
  });

  const glowStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, radiusToWeight(dist.value)) * 0.3 + active.value * 0.25,
  }));

  // Labels ride outward along the node's own spoke, so the crowded inner ring
  // never stacks text on top of text.
  const labelOffset = { x: Math.cos(angle) * 42, y: Math.sin(angle) * 42 };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.node, nodeStyle]}>
        <Animated.View style={[styles.glow, { backgroundColor: hue }, glowStyle]} />
        <View style={[styles.nodeInner, { backgroundColor: c.surfaceElevated, borderColor: hue }]}>
          <Icon name={glyph} size={16} color={hue} />
        </View>
        <VText
          variant="micro"
          numberOfLines={1}
          style={{
            position: 'absolute',
            top: 15,
            width: 74,
            left: -10,
            fontSize: 8.5,
            letterSpacing: 0,
            textAlign: 'center',
            transform: [{ translateX: labelOffset.x }, { translateY: labelOffset.y }],
          }}
          muted
        >
          {label.split(' ')[0]}
        </VText>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  core: {
    position: 'absolute',
    left: CENTER - 27,
    top: CENTER - 27,
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  legend: {
    position: 'absolute',
    top: 2,
    alignSelf: 'center',
  },
  node: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 54,
    height: 54,
    alignItems: 'center',
  },
  glow: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    top: -1,
    left: 5,
    transform: [{ scale: 1.22 }],
  },
  nodeInner: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
});
