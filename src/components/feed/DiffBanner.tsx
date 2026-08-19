import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { Glass } from '@/components/glass/Glass';
import { Icon, Touchable, VText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useAuthor, usePost, useVybe } from '@/store/useVybe';

export type FeedDiff = {
  changed: number;
  climbPostId?: string;
  climbBy?: number;
  fallPostId?: string;
  fallBy?: number;
  ledgerId?: string;
};

/**
 * After any algorithm change, the feed says what the change actually did —
 * in ranks moved, not in vague reassurance. Undo is one tap, because a change
 * you cannot reverse is not really a control.
 */
export function DiffBanner({ diff, onDismiss }: { diff: FeedDiff; onDismiss: () => void }) {
  const { c } = useTheme();
  const undoLedger = useVybe((s) => s.undoLedger);

  const climbAuthor = useAuthor(usePost(diff.climbPostId)?.authorId);
  const fallAuthor = useAuthor(usePost(diff.fallPostId)?.authorId);

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      exiting={FadeOutUp.duration(180)}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      <Glass variant="regular" radius={radius.lg} style={styles.glass}>
        <View style={[styles.dot, { backgroundColor: c.primary }]} />
        <View style={{ flex: 1, gap: 2 }}>
          <VText variant="label">
            {diff.changed === 0
              ? 'No posts moved'
              : `Your change reordered ${diff.changed} post${diff.changed === 1 ? '' : 's'}`}
          </VText>
          {climbAuthor || fallAuthor ? (
            <VText variant="caption" muted numberOfLines={1}>
              {climbAuthor ? `@${climbAuthor.handle} ↑${diff.climbBy}` : ''}
              {climbAuthor && fallAuthor ? '   ·   ' : ''}
              {fallAuthor ? `@${fallAuthor.handle} ↓${Math.abs(diff.fallBy ?? 0)}` : ''}
            </VText>
          ) : null}
        </View>

        {diff.ledgerId ? (
          <Touchable
            onPress={() => {
              undoLedger(diff.ledgerId!);
              onDismiss();
            }}
            feedback="medium"
            accessibilityLabel="Undo this algorithm change"
            style={[styles.undo, { borderColor: c.borderStrong }]}
          >
            <Icon name="rotate-ccw" size={13} color={c.text} />
            <VText variant="micro">UNDO</VText>
          </Touchable>
        ) : null}

        <Touchable onPress={onDismiss} feedback="light" hitSlop={10} accessibilityLabel="Dismiss">
          <Icon name="x" size={16} color={c.textMuted} />
        </Touchable>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    zIndex: 30,
  },
  glass: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.base,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
  },
});
