import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useVybe, type AgeRange } from '@/store/useVybe';

/**
 * "How old are you?" — one screen, during sign-up, before setup.
 *
 * ## Why a band and not a birth date
 *
 * A date of birth is the strongest identifier the app could hold, and it has no
 * use for one. The only question being asked is roughly who this is, so setup
 * can lean the right way and so an under-18 account can be treated as one.
 * Collecting the exact value and bucketing it in the client would mean storing
 * something we do not need and cannot un-store after a breach. The column is
 * `text` with a check constraint, and it is nullable — see `0009`.
 *
 * ## Why it is skippable
 *
 * A required age gate on the second screen of a product somebody has not
 * decided to use yet is a wall, and the honest answer to "we do not know" is
 * null rather than a number they picked to get past it.
 */

const OPTIONS: { id: AgeRange; label: string }[] = [
  { id: 'under-18', label: 'Under 18' },
  { id: '18-24', label: '18–24' },
  { id: '25-34', label: '25–34' },
  { id: '35-44', label: '35–44' },
  { id: '45-54', label: '45–54' },
  { id: '55-64', label: '55–64' },
  { id: 'over-64', label: 'Over 64' },
];

export default function AgeScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const setAgeRange = useVybe((s) => s.setAgeRange);

  const [selected, setSelected] = useState<AgeRange | null>(null);
  const [saving, setSaving] = useState(false);

  const commit = async (value: AgeRange | null) => {
    if (saving) return;
    setSaving(true);
    // The write is awaited but its result is not gated on: a failed save should
    // not trap somebody on the age screen. `ageAsked` is what moves the gate,
    // and the value can be set later from Edit profile.
    await setAgeRange(value);
    setSaving(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <View style={{ width: 44 }} />
        <Touchable
          onPress={() => {
            haptic('light');
            void commit(null);
          }}
          feedback="light"
          hitSlop={12}
          accessibilityLabel="Skip"
        >
          <VText variant="label" secondary>
            Skip
          </VText>
        </Touchable>
      </View>

      <ScrollView
        /*
          `flex: 1` is load-bearing, not tidying.

          A ScrollView defaults to `flexGrow: 0, flexShrink: 0`, so without this
          it sizes to its content — and seven options plus the headings are
          taller than the screen. The list then overflows this container and
          pushes the footer below the bottom edge.

          On iOS that still looked fine, because overflow is visible by default
          and the button drew where it was told. On Android overflow is clipped
          and a view outside its parent's bounds receives no touches, so most of
          Continue was dead and only the part still inside the bounds responded.
          Same layout bug on both platforms; only one of them tells you.
        */
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingBottom: space.xxl,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeIn.duration(260)} style={{ gap: space.sm }}>
          <VText variant="hero">How old are you?</VText>
          <VText variant="body" secondary>
            It helps shape what your feed opens with. You can change it later, and it is never
            shown on your profile.
          </VText>
        </Animated.View>

        <View style={{ gap: space.sm }}>
          {OPTIONS.map((o, i) => {
            const on = selected === o.id;
            return (
              <Animated.View key={o.id} entering={FadeInDown.delay(60 + i * 45).duration(280)}>
                <Touchable
                  onPress={() => {
                    haptic('select');
                    setSelected(o.id);
                  }}
                  feedback="select"
                  scaleTo={0.98}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={o.label}
                  style={[
                    styles.option,
                    {
                      backgroundColor: on ? c.volt : c.surfaceElevated,
                      borderColor: on ? c.volt : c.border,
                    },
                  ]}
                >
                  <VText variant="bodyMedium" color={on ? c.onVolt : c.text}>
                    {o.label}
                  </VText>
                  {on ? <Icon name="check" size={18} color={c.onVolt} /> : null}
                </Touchable>
              </Animated.View>
            );
          })}
        </View>

        <VText variant="caption" muted style={{ textAlign: 'center' }}>
          Your answer does not limit any feature.
        </VText>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.base, backgroundColor: c.bg }]}>
        <Button
          label="Continue"
          onPress={() => {
            haptic('medium');
            void commit(selected);
          }}
          disabled={!selected || saving}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
});
