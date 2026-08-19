import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The page ground.
 *
 * This used to paint drifting coloured blobs behind every screen. It does not
 * any more: in an editorial system the ground is paper, and paper is one flat
 * colour. Contrast, hierarchy and identity are carried by type and rules, so a
 * decorative wash behind them would only ever be noise sitting under the text.
 *
 * The component and its props are kept so screens do not each have to know how
 * their ground is painted.
 */
export function AmbientAura(_props: { intensity?: number }) {
  const { c } = useTheme();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />
  );
}
