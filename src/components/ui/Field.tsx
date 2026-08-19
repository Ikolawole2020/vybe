import React, { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Icon, Touchable, VText } from './index';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * A labelled text field.
 *
 * The label sits above the input rather than inside it as a placeholder: a
 * placeholder disappears the moment you type, which is exactly when someone
 * checking their own work needs to know which box they are in.
 */
export function Field({
  label,
  hint,
  secure,
  style,
  accessoryRight,
  ...rest
}: TextInputProps & {
  label: string;
  hint?: string;
  /** Renders a reveal toggle and starts masked. */
  secure?: boolean;
  accessoryRight?: React.ReactNode;
}) {
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);

  return (
    <View style={{ gap: 7 }}>
      <VText variant="label" secondary>
        {label}
      </VText>

      <View
        style={[
          styles.box,
          {
            backgroundColor: c.surfaceElevated,
            borderColor: focused ? c.volt : 'transparent',
          },
        ]}
      >
        <TextInput
          style={[type.body, styles.input, { color: c.text }]}
          placeholderTextColor={c.textMuted}
          secureTextEntry={secure && !shown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCorrect={false}
          {...rest}
        />
        {accessoryRight ? accessoryRight : null}
        {secure ? (
          <Touchable
            onPress={() => setShown((v) => !v)}
            feedback="select"
            hitSlop={10}
            scaleTo={0.9}
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
          >
            <Icon name={shown ? 'eye-off' : 'eye'} size={18} color={c.textMuted} />
          </Touchable>
        ) : null}
      </View>

      {hint ? (
        <VText variant="micro" muted>
          {hint}
        </VText>
      ) : null}
    </View>
  );
}

/** Inline error or notice, tinted by tone. */
export function Notice({ text, tone = 'danger' }: { text: string; tone?: 'danger' | 'good' }) {
  const { c } = useTheme();
  const color = tone === 'good' ? c.cyan : c.danger;
  return (
    <View style={[styles.notice, { borderColor: color }]}>
      <Icon name={tone === 'good' ? 'check-circle' : 'alert-circle'} size={15} color={color} />
      <VText variant="caption" color={color} style={{ flex: 1 }}>
        {text}
      </VText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  input: { flex: 1, height: '100%' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
