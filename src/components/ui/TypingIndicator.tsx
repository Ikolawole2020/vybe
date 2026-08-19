import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Avatar, VText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

function TypingDot({ delay, color }: { delay: number; color: string }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    y.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-4, { duration: 280, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 280, easing: Easing.in(Easing.quad) }),
        ),
        -1,
        true,
      ),
    );

    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 280 }),
          withTiming(0.4, { duration: 280 }),
        ),
        -1,
        true,
      ),
    );
  }, [delay, y, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        { backgroundColor: color },
        style,
      ]}
    />
  );
}

/**
 * One bar of the recording waveform.
 *
 * Deliberately not the same animation as `TypingDot`. The two indicators occupy
 * the same slot in the thread and appear under the same circumstances, so if
 * they moved alike the only thing distinguishing "typing" from "recording a
 * voice note" would be the caption — and the caption is the part that is read
 * last, if at all. Dots hop; bars breathe at different rates, the way a level
 * meter does.
 */
function WaveBar({ index, color }: { index: number; color: string }) {
  const height = useSharedValue(5);

  useEffect(() => {
    // Staggered *and* unequal in duration, so the row never falls into a
    // marching lockstep the eye reads as a progress bar.
    height.value = withDelay(
      index * 90,
      withRepeat(
        withSequence(
          withTiming(14 - (index % 3) * 3, { duration: 300 + (index % 4) * 70 }),
          withTiming(5, { duration: 300 + (index % 4) * 70 }),
        ),
        -1,
        true,
      ),
    );
  }, [index, height]);

  const style = useAnimatedStyle(() => ({ height: height.value }));

  return <Animated.View style={[styles.waveBar, { backgroundColor: color }, style]} />;
}

/**
 * "…is typing" / "…is recording a voice note", in the thread.
 *
 * One component for both because they are one idea — the other person is doing
 * something and has not sent it yet — and because they must never be on screen
 * together. A single `kind` makes that structural rather than something two
 * booleans have to be trusted to agree about.
 */
export function TypingIndicator({
  userName,
  userAvatar,
  kind = 'typing',
}: {
  userName?: string;
  userAvatar?: string;
  kind?: 'typing' | 'recording';
}) {
  const { c } = useTheme();
  const recording = kind === 'recording';
  // Red for recording, the colour a record light has been for fifty years.
  const accent = recording ? c.ember : c.volt;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={styles.wrap}
    >
      {userAvatar ? (
        <Avatar uri={userAvatar} size={24} />
      ) : null}

      <View
        style={[
          styles.bubble,
          {
            backgroundColor: c.surfaceElevated,
            borderColor: c.border,
          },
        ]}
      >
        {recording ? (
          <View style={styles.waveRow}>
            {[0, 1, 2, 3, 4].map((i) => (
              <WaveBar key={i} index={i} color={accent} />
            ))}
          </View>
        ) : (
          <View style={styles.dotsRow}>
            <TypingDot delay={0} color={accent} />
            <TypingDot delay={140} color={accent} />
            <TypingDot delay={280} color={accent} />
          </View>
        )}

        {userName ? (
          <VText variant="micro" muted style={styles.nameText}>
            {recording ? `${userName} is recording…` : `${userName} is typing...`}
          </VText>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginVertical: 4,
    paddingHorizontal: space.base,
    alignSelf: 'flex-start',
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.xl,
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 16,
  },
  waveBar: {
    width: 3,
    borderRadius: 1.5,
  },
  nameText: {
    marginLeft: 2,
    fontSize: 11,
  },
});
