import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Opaque status-bar band for screens with no header of their own.
 *
 * A solid block rather than the gradient fade this used to be: on paper a fade
 * reads as a smudge, and content should meet the band on a clean edge.
 * Render it *after* the scroll view so it sits on top.
 */
export function TopScrim() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        height: insets.top,
        backgroundColor: c.bg,
      }}
    />
  );
}
