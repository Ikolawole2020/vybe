import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, VText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import type { Boundary } from '@/data/types';
import { useVybe } from '@/store/useVybe';

/**
 * Shows a post's Boundary at a glance. Two facts, always in the same order:
 * who can see it, and who can reply. A locked reply set is the interesting
 * case, so it gets the colour.
 */
export function BoundaryBadge({
  boundary,
  /**
   * Floating over media rather than sitting on a card. An outline alone
   * disappears against a photograph, so the badge gains a dark plate and
   * switches to white text — the tone survives only as the icon.
   */
  onMedia = false,
}: {
  boundary: Boundary;
  onMedia?: boolean;
}) {
  const { c } = useTheme();
  const circles = useVybe((s) => s.circles);

  const publicView = boundary.visibleTo.includes('public');
  const publicInteract = boundary.canInteract.includes('public');
  if (publicView && publicInteract) return null;

  const named = (ids: string[]) =>
    ids
      .map((id) => (id === 'public' ? 'Everyone' : circles.find((cc) => cc.id === id)?.name))
      .filter(Boolean)
      .join(' + ');

  const restrictedView = !publicView;
  const tone = restrictedView ? c.primary : c.cyan;
  const label = restrictedView ? named(boundary.visibleTo) : `${named(boundary.canInteract)} can reply`;

  return (
    <View
      style={[
        styles.badge,
        onMedia
          ? { borderColor: 'transparent', backgroundColor: c.overlayStrong, paddingVertical: 6 }
          : { borderColor: tone },
      ]}
      accessibilityLabel={
        restrictedView
          ? `Visible only to ${named(boundary.visibleTo)}. ${named(boundary.canInteract)} can reply.`
          : `Everyone can see this. Only ${named(boundary.canInteract)} can reply.`
      }
    >
      <Icon name={restrictedView ? 'lock' : 'message-square'} size={10} color={tone} />
      <VText variant="micro" color={onMedia ? c.onOverlay : tone} numberOfLines={1}>
        {label}
      </VText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 150,
  },
});
