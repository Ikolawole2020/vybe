import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { radius as R, rule, space } from '@/theme/tokens';
import { Touchable } from './index';

/**
 * Editorial structure primitives.
 *
 * There are no cards in this app. A group of related things is a run of
 * full-bleed rows separated by hairline rules; a section break is a heavier
 * rule. That is the entire vocabulary — see the note at the top of tokens.ts.
 */

/** A horizontal rule. `weight` picks its role, not just its thickness. */
export function Rule({
  weight = 'hair',
  /** Left inset, used to align a divider with the text column above it. */
  inset = 0,
  color,
  style,
}: {
  weight?: keyof typeof rule;
  inset?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <View
      style={[
        {
          height: rule[weight],
          marginLeft: inset,
          backgroundColor: color ?? (weight === 'hair' ? c.border : c.borderStrong),
        },
        style,
      ]}
    />
  );
}

/**
 * A full-bleed list row.
 *
 * Bleeds to the screen edges and applies the page gutter itself, so a list of
 * these produces X-style edge-to-edge rules with correctly inset content. The
 * rule is drawn at the bottom, and `last` drops it so a run does not end on a
 * dangling line.
 */
export function Row({
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  /** Suppresses the bottom rule — set on the final row of a run. */
  last = false,
  /** Aligns the rule with the content rather than the screen edge. */
  ruleInset = 0,
  /** Vertical padding. Rows are dense by default. */
  padded = true,
  style,
  children,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  last?: boolean;
  ruleInset?: number;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const body = (
    <View
      style={[
        {
          paddingHorizontal: space.gutter,
          paddingVertical: padded ? space.md : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  return (
    <View>
      {onPress || onLongPress ? (
        <PressableRow
          onPress={onPress}
          onLongPress={onLongPress}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
        >
          {body}
        </PressableRow>
      ) : (
        body
      )}
      {last ? null : <Rule inset={ruleInset} />}
    </View>
  );
}

/**
 * Row press feedback is a ground tint, not a scale.
 *
 * Scaling a full-bleed row would pull it away from the rules above and below
 * it and break the column; a fill keeps the structure rigid while still
 * answering the touch.
 */
function PressableRow({
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  children,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="light"
      scaleTo={1}
      pressedBackground={c.surfacePressed}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
    >
      {children}
    </Touchable>
  );
}

/**
 * A distinct object rather than a row in a list — a receipt, a callout, a
 * quoted post. A rounded plate one step off the ground.
 *
 * `accent` tints the border rather than filling the plate: a Block is usually
 * nested inside a card that is already lit, and a second fill at that depth
 * competes with the card it sits in.
 */
export function Block({
  /** Draws the left edge heavier, the way a print sidebar or pull-quote does. */
  marker,
  accent,
  onPress,
  accessibilityLabel,
  style,
  children,
}: {
  marker?: boolean;
  accent?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const { c } = useTheme();

  const body = (
    <View
      style={[
        {
          borderRadius: R.xl,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: accent ?? 'transparent',
          backgroundColor: c.bgSubtle,
          padding: space.base,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return body;
  return (
    <Touchable
      onPress={onPress}
      feedback="light"
      scaleTo={1}
      pressedBackground={c.surfacePressed}
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </Touchable>
  );
}

/** The page ground. Flat paper — no gradient, no blobs, no texture. */
export function PaperGround() {
  const { c } = useTheme();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]} />
  );
}
