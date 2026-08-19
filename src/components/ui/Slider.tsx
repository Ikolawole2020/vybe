import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, spring } from '@/theme/tokens';

const TRACK_H = 10;
const THUMB = 26;

/**
 * Gesture slider with two modes:
 *  - bipolar: -1 … 1, fill grows out of the centre (used for topic weights,
 *    where "less of this" is a real, visible negative rather than just "off")
 *  - unipolar: 0 … 1 for the dials.
 *
 * The whole row is draggable, not just the thumb, so the target is the full
 * width rather than a 26pt dot.
 */
export function Slider({
  value,
  onChange,
  bipolar,
  tone,
  negativeTone,
  label,
  hint,
  leftLabel,
  rightLabel,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  bipolar?: boolean;
  tone?: string;
  negativeTone?: string;
  label?: string;
  hint?: string;
  leftLabel?: string;
  rightLabel?: string;
  format?: (v: number) => string;
}) {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  const min = bipolar ? -1 : 0;
  const range = bipolar ? 2 : 1;

  const pos = useSharedValue(0); // 0…1 along the track
  const dragging = useSharedValue(0);
  const lastStep = useSharedValue(0);

  React.useEffect(() => {
    const p = (value - min) / range;
    if (dragging.value === 0) pos.value = withSpring(p, spring.snappy);
  }, [value, min, range, pos, dragging]);

  const emit = useCallback(
    (p: number) => onChange(Math.round((min + p * range) * 100) / 100),
    [min, onChange, range],
  );

  const setFromX = (x: number) => {
    'worklet';
    if (!width) return;
    const p = Math.max(0, Math.min(1, x / width));
    pos.value = p;
    const step = Math.round(p * 20);
    if (step !== lastStep.value) {
      lastStep.value = step;
      runOnJS(haptic)('select');
    }
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      dragging.value = 1;
      setFromX(e.x);
    })
    .onUpdate((e) => setFromX(e.x))
    .onEnd(() => {
      dragging.value = 0;
      runOnJS(emit)(pos.value);
    });

  const tap = Gesture.Tap().onEnd((e) => {
    setFromX(e.x);
    runOnJS(emit)(Math.max(0, Math.min(1, e.x / Math.max(width, 1))));
  });

  const positiveTone = tone ?? c.primary;
  const negTone = negativeTone ?? c.ember;

  const fill = useAnimatedStyle(() => {
    if (!bipolar) return { left: 0, width: `${pos.value * 100}%`, backgroundColor: positiveTone };
    const signed = pos.value - 0.5;
    return {
      left: `${(signed >= 0 ? 0.5 : pos.value) * 100}%`,
      width: `${Math.abs(signed) * 100}%`,
      backgroundColor: signed >= 0 ? positiveTone : negTone,
    };
  });

  const thumb = useAnimatedStyle(() => ({
    left: pos.value * Math.max(width - THUMB, 0),
    transform: [{ scale: 1 + dragging.value * 0.18 }],
  }));

  const shown = format
    ? format(value)
    : bipolar
      ? `${value > 0 ? '+' : ''}${value.toFixed(2)}`
      : `${Math.round(value * 100)}%`;

  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <View style={styles.labelRow}>
          <VText variant="label">{label}</VText>
          <VText
            variant="numeric"
            color={bipolar ? (value >= 0 ? positiveTone : negTone) : c.textSecondary}
          >
            {shown}
          </VText>
        </View>
      ) : null}

      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View
          style={styles.hit}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: shown }}
        >
          <View style={[styles.track, { backgroundColor: c.bgSubtle, borderColor: c.border }]}>
            {bipolar ? (
              <View style={[styles.centerTick, { backgroundColor: c.borderStrong }]} />
            ) : null}
            <Animated.View style={[styles.fill, fill]} />
          </View>
          <Animated.View
            style={[
              styles.thumb,
              { backgroundColor: c.text, borderColor: c.bg },
              thumb,
            ]}
          />
        </View>
      </GestureDetector>

      {leftLabel || rightLabel ? (
        <View style={styles.labelRow}>
          <VText variant="micro" muted style={{ letterSpacing: 0 }}>
            {leftLabel}
          </VText>
          <VText variant="micro" muted style={{ letterSpacing: 0 }}>
            {rightLabel}
          </VText>
        </View>
      ) : null}

      {hint ? (
        <VText variant="caption" muted style={{ marginTop: 2 }}>
          {hint}
        </VText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  hit: { height: 44, justifyContent: 'center' },
  track: {
    height: TRACK_H,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  centerTick: {
    position: 'absolute',
    left: '50%',
    width: StyleSheet.hairlineWidth,
    top: 0,
    bottom: 0,
  },
  fill: { position: 'absolute', top: 0, bottom: 0 },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
  },
});
