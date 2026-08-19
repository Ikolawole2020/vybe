import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { duration } from '@/theme/tokens';

/**
 * Entrance choreography.
 *
 * Content arrives in order rather than all at once, which is what makes a
 * screen feel authored instead of dumped. `ReduceMotion.System` means the
 * translate is dropped automatically when the OS asks for less motion — the
 * content still appears, it just stops travelling.
 *
 * The whole screen must finish assembling inside ~250ms. Past that the stagger
 * stops reading as choreography and starts reading as loading — the screen
 * looks like it is waiting on a network call it never makes.
 */
export function Reveal({
  index = 0,
  /** Per-item offset. Capped at 4 steps, so the tail never exceeds 100ms. */
  step = 26,
  distance = 10,
  style,
  children,
}: {
  index?: number;
  step?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <Animated.View
      style={style}
      entering={FadeInDown.delay(Math.min(index, 4) * step)
        .duration(duration.base)
        .withInitialValues({ transform: [{ translateY: distance }] })
        .reduceMotion(ReduceMotion.System)}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Bento row. Children are laid out as flexible cells on one line, with each
 * child's `flex` taken from `spans` — so a 2/1 row is `spans={[2, 1]}`.
 */
export function Bento({
  spans,
  gap = 10,
  style,
  children,
}: {
  spans: number[];
  gap?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const cells = React.Children.toArray(children);
  return (
    <View style={[{ flexDirection: 'row', gap }, style]}>
      {cells.map((child, i) => (
        <View key={i} style={{ flex: spans[i] ?? 1 }}>
          {child}
        </View>
      ))}
    </View>
  );
}
