import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { VText } from './index';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * A one-time code, drawn as separate boxes.
 *
 * There is still only one `TextInput` — it lies invisible across the whole row
 * and the boxes are a rendering of its value. Six real inputs would look the
 * same and behave worse: iOS autofills a `oneTimeCode` field by pasting the
 * whole code at once, which only lands in the first of six, and backspacing
 * across separate inputs means tracking focus by hand. Holding one value means
 * paste, autofill, backspace and select-all are the platform's problem.
 */
export function CodeInput({
  label,
  hint,
  value,
  onChangeText,
  length = 6,
  autoFocus,
  editable = true,
}: {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const { c } = useTheme();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  // The caret sits in the first empty box, and stays in the last box once the
  // code is complete rather than disappearing off the end of the row.
  const caretAt = Math.min(value.length, length - 1);

  return (
    <View style={{ gap: 7 }}>
      <VText variant="label" secondary>
        {label}
      </VText>

      {/* Not a row itself — the cells size themselves off the inner row, and
          nesting one row inside another leaves it hugging its content while
          six `flex: 1` children divide a width of zero between them. */}
      <Pressable onPress={() => ref.current?.focus()}>
        {/* Decorative: the input below carries the label and the value, so the
            row must not also be read out as six separate empty fields. */}
        <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length }, (_, i) => {
            const digit = value[i] ?? '';
            const active = focused && i === caretAt;
            return (
              <View
                key={i}
                style={[
                  styles.cell,
                  {
                    backgroundColor: c.surfaceElevated,
                    // Every box is outlined. An empty box with no border reads
                    // as a gap rather than as somewhere a digit is going to go,
                    // which is most of them for most of the time here.
                    borderColor: active ? c.volt : c.border,
                  },
                ]}
              >
                {digit ? (
                  <VText variant="title">{digit}</VText>
                ) : active ? (
                  <Caret color={c.volt} />
                ) : null}
              </View>
            );
          })}
        </View>

        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={editable}
          keyboardType="number-pad"
          // Lets iOS offer the code straight from the notification.
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus={autoFocus}
          maxLength={length}
          accessibilityLabel={label}
          // Invisible rather than absent: it has to stay in the layout to take
          // the tap, hold the selection and raise the keyboard.
          style={[StyleSheet.absoluteFill, styles.hidden]}
          caretHidden
          selectionColor="transparent"
        />
      </Pressable>

      {hint ? (
        <VText variant="micro" muted>
          {hint}
        </VText>
      ) : null}
    </View>
  );
}

/** Blinks at the system rate, so an empty row still says "type here". */
function Caret({ color }: { color: string }) {
  const o = useSharedValue(1);

  useEffect(() => {
    o.value = withRepeat(
      withSequence(withTiming(0, { duration: 450 }), withTiming(1, { duration: 450 })),
      -1,
      false,
    );
  }, [o]);

  const style = useAnimatedStyle(() => ({ opacity: o.value }));

  return <Animated.View style={[styles.caret, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  cell: {
    flex: 1,
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `opacity: 0` rather than `display: 'none'` or a colour of transparent —
  // the field must still be hit-testable and focusable.
  hidden: { opacity: 0, ...type.title },
  caret: { width: 2, height: 24, borderRadius: 1 },
});
