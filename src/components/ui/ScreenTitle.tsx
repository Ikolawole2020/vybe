import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { VText } from './index';

/**
 * Screen title.
 *
 * A large weight-800 line and, at most, one line of context under it. No
 * kicker, no rule, no ornament — on a dark ground the size difference alone
 * establishes the hierarchy, and anything else added here becomes chrome.
 */
export function ScreenTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <VText variant="mega" style={{ flex: 1 }}>
          {title}
        </VText>
        {action}
      </View>
      {subtitle ? (
        <VText variant="callout" muted style={{ maxWidth: 340 }}>
          {subtitle}
        </VText>
      ) : null}
    </View>
  );
}

/**
 * Section head for a run of rows. Sits directly on the ground with a hairline
 * beneath it, so the label reads as part of the list rather than a banner.
 */
export function SectionHead({
  label,
  note,
  action,
  /** Set when the caller already applies the page gutter. */
  flush,
}: {
  label: string;
  note?: string;
  action?: React.ReactNode;
  flush?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View>
      <View
        style={{
          paddingHorizontal: flush ? 0 : space.gutter,
          paddingBottom: space.sm,
          gap: 2,
        }}
      >
        <View style={styles.headRow}>
          <VText variant="heading" style={{ flex: 1 }}>
            {label}
          </VText>
          {action}
        </View>
        {note ? (
          <VText variant="caption" muted>
            {note}
          </VText>
        ) : null}
      </View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
});
