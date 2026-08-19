import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Icon, Touchable, VText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { budgetPressure, useVybe } from '@/store/useVybe';

/**
 * Attention budget ring.
 *
 * Vybe counts *down* the time you gave yourself rather than counting up the
 * time it extracted from you. The ring is the only always-visible number in
 * the app, and it is the one number the product is trying to make smaller.
 */
export function BudgetRing({ size = 34, onPress }: { size?: number; onPress?: () => void }) {
  const { c } = useTheme();
  const budget = useVybe((s) => s.budget);
  const p = budgetPressure(budget);

  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const over = p >= 1;
  const tone = over ? c.ember : p > 0.75 ? c.warning : c.primary;
  const remaining = Math.max(0, Math.round(budget.limitMinutes - budget.spentSeconds / 60));

  const body = (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tone}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(p, 1))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {over ? (
        <Icon name="moon" size={13} color={tone} />
      ) : (
        <VText variant="micro" color={tone} style={{ fontSize: 10, letterSpacing: 0 }}>
          {remaining}
        </VText>
      )}
    </View>
  );

  if (!budget.enabled) return null;
  if (!onPress) return body;
  return (
    <Touchable
      onPress={onPress}
      feedback="light"
      hitSlop={10}
      accessibilityLabel={
        over
          ? 'Attention budget spent for today'
          : `${remaining} minutes left of your ${budget.limitMinutes} minute budget`
      }
    >
      {body}
    </Touchable>
  );
}
