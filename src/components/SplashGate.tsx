import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { VText } from '@/components/ui';

/**
 * The animated wordmark that plays over the native splash.
 *
 * ## Why this exists at all
 *
 * A native splash screen is a static image — it cannot animate, and it is the
 * first thing anyone sees. The trick used by every app whose opening feels
 * considered is a handoff: the native splash holds a *still frame* that matches
 * the first frame of this component exactly, this mounts underneath it, the
 * native splash is dismissed, and the animation runs. Done right the seam is
 * invisible and the app appears to have been animating since launch.
 *
 * `app.json`'s splash background is `#08080C`; this paints the same colour, so
 * the handoff is a cross-fade between two identical grounds.
 *
 * ## The animation, and the thinking behind it
 *
 * Three things happen, staggered, over about 1.4 seconds.
 *
 * 1. **Letters rise and fade in, one at a time, 55ms apart.** Per-letter rather
 *    than per-word because a wordmark assembling itself reads as deliberate
 *    where a whole word fading in reads as a loading state. Each letter also
 *    starts 8px low and settles — the vertical travel is what makes it feel
 *    like type being set rather than opacity being tweened.
 *
 * 2. **Letter-spacing contracts from 18 to 2.** This is the move that carries
 *    the whole thing. Wide tracking reads as "logo", tight tracking reads as
 *    "word"; animating between them is a wordmark resolving into itself. It is
 *    also the reason the letters are laid out individually — React Native
 *    cannot animate `letterSpacing` on a Text node, so each glyph is its own
 *    animated view and the spacing is margin.
 *
 * 3. **A volt underscore sweeps out from the centre**, then the whole lockup
 *    lifts very slightly and fades. The accent is the one piece of brand colour
 *    on an otherwise monochrome screen, and it arrives last so it lands as
 *    punctuation rather than decoration.
 *
 * The exit is a 260ms fade with a small upward drift. Scaling the wordmark down
 * on exit was the obvious alternative and it looked like a dismissal; drifting
 * up reads as the app rising to meet you.
 */

const WORD = 'Vybe';
/** Milliseconds between each letter starting. */
const STAGGER = 55;
const LETTER_IN = 380;
/** How long the finished lockup is held before it leaves. */
const HOLD = 420;
const OUT = 260;

const TOTAL = WORD.length * STAGGER + LETTER_IN + HOLD;

export function SplashGate({ onDone }: { onDone: () => void }) {
  const [gone, setGone] = useState(false);

  // One clock drives everything. Separate timelines per element drift apart on a
  // slow first frame, which on the very screen that is covering a cold start is
  // exactly when they will.
  const t = useSharedValue(0);
  const exit = useSharedValue(0);

  useEffect(() => {
    t.value = withTiming(1, {
      duration: WORD.length * STAGGER + LETTER_IN,
      easing: Easing.out(Easing.cubic),
    });

    exit.value = withDelay(
      TOTAL,
      withTiming(1, { duration: OUT, easing: Easing.in(Easing.quad) }, (finished) => {
        // `runOnJS` because this callback runs on the UI thread and `onDone`
        // sets React state. Guarded on `finished` so an interrupted animation —
        // a fast refresh, an unmount — does not report completion.
        if (finished) runOnJS(setGone)(true);
      }),
    );
  }, [t, exit]);

  useEffect(() => {
    if (gone) onDone();
  }, [gone, onDone]);

  const lockupStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ translateY: -14 * exit.value }],
  }));

  const ruleStyle = useAnimatedStyle(() => {
    // Starts after the last letter has landed.
    const p = interpolate(t.value, [0.72, 1], [0, 1], 'clamp');
    return { transform: [{ scaleX: p }], opacity: p };
  });

  if (gone) return null;

  return (
    <View style={styles.fill} pointerEvents="none">
      <Animated.View style={[styles.lockup, lockupStyle]}>
        <View style={styles.word}>
          {WORD.split('').map((ch, i) => (
            <Letter key={i} char={ch} index={i} t={t} />
          ))}
        </View>
        <Animated.View style={[styles.rule, ruleStyle]} />
      </Animated.View>
    </View>
  );
}

function Letter({
  char,
  index,
  t,
}: {
  char: string;
  index: number;
  t: SharedValue<number>;
}) {
  const total = WORD.length * STAGGER + LETTER_IN;
  const start = (index * STAGGER) / total;
  const end = (index * STAGGER + LETTER_IN) / total;

  const style = useAnimatedStyle(() => {
    const p = interpolate(t.value, [start, end], [0, 1], 'clamp');
    return {
      opacity: p,
      transform: [{ translateY: interpolate(p, [0, 1], [8, 0]) }],
      // Tracking closes as the word assembles: 18 → 2. The last letter gets no
      // trailing margin, or the lockup sits visibly off-centre.
      marginRight: index === WORD.length - 1 ? 0 : interpolate(p, [0, 1], [18, 2]),
    };
  });

  return (
    <Animated.View style={style}>
      <VText variant="hero" style={styles.glyph}>
        {char}
      </VText>
    </Animated.View>
  );
}

/** Matches `app.json`'s splash `backgroundColor` so the handoff is seamless. */
export const SPLASH_BG = '#08080C';

const styles = StyleSheet.create({
  fill: {
    ...(StyleSheet.absoluteFill as object),
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the navigator, which is already mounted and rendering behind this.
    zIndex: 999,
  },
  lockup: { alignItems: 'center', gap: 14 },
  word: { flexDirection: 'row', alignItems: 'flex-end' },
  glyph: {
    fontSize: 44,
    lineHeight: 52,
    color: '#FFFFFF',
    fontFamily: 'Outfit_600SemiBold',
  },
  rule: {
    width: 52,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#D2F34C',
  },
});
