import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Glass } from '@/components/glass/Glass';
import { haptic, type HapticKind } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { duration, iconSize, radius, space, spring, type } from '@/theme/tokens';

type TypeKey = keyof typeof type;

export function VText({
  variant = 'body',
  color,
  muted,
  secondary,
  style,
  children,
  ...rest
}: TextProps & {
  variant?: TypeKey;
  color?: string;
  muted?: boolean;
  secondary?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const { c } = useTheme();
  const resolved = color ?? (muted ? c.textMuted : secondary ? c.textSecondary : c.text);
  return (
    <Text style={[type[variant], { color: resolved }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Icon({
  name,
  size = iconSize.md,
  color,
  style,
}: {
  name: React.ComponentProps<typeof Feather>['name'];
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const { c } = useTheme();
  return <Feather name={name} size={size} color={color ?? c.text} style={style} />;
}

export { haptic, type HapticKind };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Standard tappable. Scales and dims on press without changing layout bounds,
 * so neighbouring content never jitters.
 */
export function Touchable({
  onPress,
  feedback = 'light',
  scaleTo = 0.97,
  pressedBackground,
  style,
  children,
  disabled,
  ...rest
}: PressableProps & {
  feedback?: HapticKind;
  scaleTo?: number;
  pressedBackground?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => {
    if (pressedBackground) {
      return { backgroundColor: pressed.value ? pressedBackground : 'transparent' };
    }
    return {
      transform: [{ scale: 1 - pressed.value * (1 - scaleTo) }],
      opacity: (1 - pressed.value * 0.25) * (disabled ? 0.4 : 1),
    };
  });

  const handlePress = useCallback(
    (e: any) => {
      if (disabled) return;
      try {
        haptic(feedback);
      } catch {}
      onPress?.(e);
    },
    [disabled, feedback, onPress],
  );

  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      unstable_pressDelay={40}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: duration.instant });
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, spring.snappy);
      }}
      onPress={handlePress}
      style={[animated, style]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Avatar({
  uri,
  size = 40,
  ring,
}: {
  uri?: string | null;
  size?: number;
  ring?: string;
}) {
  const { c } = useTheme();
  const [loadError, setLoadError] = React.useState(false);
  const showFallback = !uri || loadError;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        padding: ring ? 2 : 0,
        borderWidth: ring ? 2 : 0,
        borderColor: ring ?? 'transparent',
        backgroundColor: c.surfaceElevated,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {showFallback ? (
        <View
          style={{
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.surfaceElevated,
          }}
        >
          <Icon name="user" size={Math.max(12, Math.round(size * 0.48))} color={c.textMuted} />
        </View>
      ) : (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%', borderRadius: size / 2 }}
          contentFit="cover"
          transition={90}
          cachePolicy="memory-disk"
          onError={() => setLoadError(true)}
        />
      )}
    </View>
  );
}

export function Chip({
  label,
  glyph,
  active,
  tone,
  onPress,
  size = 'md',
  style,
}: {
  label: string;
  glyph?: React.ComponentProps<typeof Feather>['name'];
  active?: boolean;
  tone?: string;
  onPress?: () => void;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const edge = tone ?? c.volt;
  const fill = active ? edge : c.surfaceElevated;
  const fg = active ? (c.onVolt ?? '#0A0B0E') : c.textSecondary;
  const pad =
    size === 'sm'
      ? { paddingVertical: 8, paddingHorizontal: 13 }
      : { paddingVertical: 11, paddingHorizontal: 16 };

  const body = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          borderRadius: radius.pill,
          backgroundColor: fill,
        },
        pad,
        style,
      ]}
    >
      {glyph ? <Icon name={glyph} size={size === 'sm' ? 12 : 14} color={fg} /> : null}
      <Text style={[size === 'sm' ? type.micro : type.label, { color: fg, fontWeight: active ? '700' : '500' }]}>{label}</Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Touchable
      onPress={onPress}
      feedback="select"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      hitSlop={8}
    >
      {body}
    </Touchable>
  );
}

export function Button({
  label,
  glyph,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  label: string;
  glyph?: React.ComponentProps<typeof Feather>['name'];
  onPress?: () => void;
  variant?: 'primary' | 'accent' | 'ghost' | 'danger' | 'glass';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const map = {
    primary: { bg: c.volt, fg: c.onVolt, border: c.volt },
    accent: { bg: c.accent, fg: c.onAccent, border: c.accent },
    ghost: { bg: c.surfaceElevated, fg: c.text, border: 'transparent' },
    danger: { bg: c.danger, fg: '#fff', border: c.danger },
    glass: { bg: 'transparent', fg: c.text, border: 'transparent' },
  }[variant];

  const inner = (
    <>
      {loading ? (
        <ActivityIndicator color={map.fg} size="small" />
      ) : (
        <>
          {glyph ? <Icon name={glyph} size={iconSize.sm} color={map.fg} /> : null}
          <Text style={[type.subheading, { color: map.fg }]}>{label}</Text>
        </>
      )}
    </>
  );

  if (variant === 'glass') {
    return (
      <Glass
        variant="regular"
        interactive
        radius={radius.pill}
        style={[styles.glassBtn, style as ViewStyle]}
      >
        <Touchable
          onPress={onPress}
          disabled={disabled || loading}
          feedback="medium"
          accessibilityLabel={label}
          style={styles.btnBody}
        >
          {inner}
        </Touchable>
      </Glass>
    );
  }

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || loading}
      feedback="medium"
      accessibilityLabel={label}
      style={[
        {
          minHeight: 52,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          backgroundColor: map.bg,
          borderWidth: 1,
          borderColor: map.border,
        },
        style,
      ]}
    >
      {inner}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  glassBtn: { overflow: 'hidden' },
  btnBody: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
});

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.divider, marginLeft: inset }} />
  );
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ marginBottom: space.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        <View style={{ flex: 1 }}>
          <VText variant="heading">{title}</VText>
          {subtitle ? (
            <VText variant="caption" muted style={{ marginTop: 3 }}>
              {subtitle}
            </VText>
          ) : null}
        </View>
        {action}
      </View>
    </View>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[type.numeric, { color: tone ?? c.text }]}>{value}</Text>
      <Text style={[type.micro, { color: c.textMuted, textTransform: 'uppercase' }]}>{label}</Text>
    </View>
  );
}

export { radius, space, iconSize, type, spring, duration };