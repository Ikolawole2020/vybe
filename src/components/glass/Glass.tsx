import React from 'react';
import { Platform, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * True only on iOS 26+, where the system can render real Liquid Glass with
 * live refraction. Everywhere else we degrade to a blur, then to a solid.
 */
export const LIQUID_GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable();

type GlassProps = ViewProps & {
  /** `clear` is the thinner, more transparent material used over media. */
  variant?: 'regular' | 'clear';
  /** Optional colour wash pushed through the material. */
  tint?: string;
  /** Reacts to touch with the system's specular highlight (iOS 26 only). */
  interactive?: boolean;
  radius?: number;
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
};

/**
 * One surface, three implementations. Call sites never branch on platform.
 */
export function Glass({
  variant = 'regular',
  tint,
  interactive = false,
  radius = 24,
  style,
  children,
  ...rest
}: GlassProps) {
  const { c, isDark } = useTheme();
  const shape: ViewStyle = { borderRadius: radius, overflow: 'hidden' };

  if (LIQUID_GLASS) {
    // Left untinted, the system material lifts toward white and blows out a
    // dark UI. A low-alpha ground tint keeps it reading as glass over our own
    // surface rather than as a bright slab.
    const systemTint = tint ?? (isDark ? '#0A0B0D' : '#F4F5F1');
    return (
      <GlassView
        glassEffectStyle={variant}
        tintColor={systemTint}
        isInteractive={interactive}
        style={[shape, style]}
        {...rest}
      >
        {children}
      </GlassView>
    );
  }

  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return (
      <View style={[shape, style]} {...rest}>
        <BlurView
          intensity={variant === 'clear' ? 40 : 72}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: tint ?? c.glassTint, opacity: variant === 'clear' ? 0.5 : 0.82 },
          ]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.glassBorder,
            },
          ]}
          pointerEvents="none"
        />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        shape,
        {
          backgroundColor: tint ?? c.surfaceElevated,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.glassBorder,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/**
 * Wraps sibling Glass elements so iOS 26 can merge and morph them into one
 * another as they move — the effect that makes a floating toolbar feel like a
 * single blob of liquid rather than a row of separate chips.
 */
export function GlassGroup({
  spacing = 8,
  style,
  children,
}: {
  spacing?: number;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}) {
  // GlassContainer is only meaningful where liquid glass actually renders; the
  // fallback is a plain row so layout is identical across platforms.
  if (LIQUID_GLASS) {
    const { GlassContainer } = require('expo-glass-effect') as typeof import('expo-glass-effect');
    return (
      <GlassContainer spacing={spacing} style={style}>
        {children}
      </GlassContainer>
    );
  }
  return <View style={style}>{children}</View>;
}
