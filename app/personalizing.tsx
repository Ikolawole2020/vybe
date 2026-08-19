import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Button, Icon, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { TOPIC_BY_ID } from '@/data/topics';
import { SETUP_PRESETS, useVybe, type SetupPreset } from '@/store/useVybe';
import { useAuth } from '@/store/useAuth';

/**
 * The last screen of setup: a receipt, not a loading bar.
 *
 * ## What this replaced, and why
 *
 * It used to be a pulsing radar dot over five checklist rows that ticked
 * themselves off on 620ms timers — "Lifting photography and design",
 * "Ranking 40 posts", "Leaving the rest to you" — behind a progress bar that
 * filled at a rate no work was being done at.
 *
 * None of it was true. `applySetup` writes local state and queues a debounced
 * save; it takes under a millisecond. The screen was three seconds of theatre
 * asserting effort that had not happened, which is both dishonest and — because
 * every generated onboarding flow reaches for exactly this — reads as
 * machine-made.
 *
 * ## What it is now
 *
 * Vybe's entire argument is that your algorithm is yours and you can read it.
 * So the moment after setup should not be a machine telling you it is thinking.
 * It should be the app repeating your decision back to you, so you leave
 * knowing what you just did.
 *
 * Concretely: the topics you picked, as the photographs you picked them from —
 * so the choice you made is the thing you see, not a summary of it. Then one
 * plain line naming the temperament, and a button.
 *
 * **The button matters more than it looks.** An auto-advancing timer makes this
 * something being done *to* you, and its length is a guess about your reading
 * speed. Tapping to continue makes it a moment you close yourself, and it is
 * the same gesture that commits the setup — `applySetup` flips `onboarded`,
 * which closes this screen's guard and hands routing to the feed.
 */
export default function PersonalizingScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();

  const applySetup = useVybe((s) => s.applySetup);
  const firstName = useAuth((s) => {
    const meta = s.user?.user_metadata as { display_name?: string } | undefined;
    return meta?.display_name?.trim().split(' ')[0] ?? '';
  });

  const params = useLocalSearchParams<{ more?: string; less?: string; preset?: string }>();
  const choice = useMemo(() => {
    const split = (v?: string) => (v ? v.split(',').filter(Boolean) : []);
    return {
      more: split(params.more),
      less: split(params.less),
      preset: (params.preset as SetupPreset) ?? 'balanced',
    };
  }, [params.more, params.less, params.preset]);

  const picked = choice.more.map((id) => TOPIC_BY_ID[id]).filter(Boolean);
  const preset = SETUP_PRESETS[choice.preset];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + space.xxl,
          paddingBottom: space.xxl,
          paddingHorizontal: space.lg,
          gap: space.xl,
        }}
      >
        <Animated.View entering={FadeIn.duration(420)} style={{ gap: space.sm }}>
          <VText variant="mega">
            {firstName ? `That's your feed,\n${firstName}.` : "That's your feed."}
          </VText>
          <VText variant="body" secondary>
            Built from what you just chose, and nothing else. No defaults, no guesses.
          </VText>
        </Animated.View>

        {picked.length > 0 ? (
          <View style={{ gap: space.md }}>
            <VText variant="label" muted>
              {picked.length === 1 ? 'YOU PICKED' : `YOU PICKED ${picked.length}`}
            </VText>

            {/*
              The photographs from the picker, not a list of their names. The
              tile is the thing that was tapped, so showing it back is a receipt
              rather than a description — and it lands as a reward for having
              made the choice at all.
            */}
            <View style={styles.grid}>
              {picked.map((t, i) => (
                <Animated.View
                  key={t.id}
                  entering={FadeInDown.delay(120 + i * 55).duration(340)}
                  style={[styles.tile, { backgroundColor: t.hue }]}
                >
                  {t.image ? (
                    <Image
                      source={{ uri: t.image }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      transition={260}
                      cachePolicy="memory-disk"
                    />
                  ) : null}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.7)']}
                    style={StyleSheet.absoluteFill}
                  />
                  <VText variant="micro" color="#FFFFFF" numberOfLines={1} style={styles.tileLabel}>
                    {t.label}
                  </VText>
                </Animated.View>
              ))}
            </View>
          </View>
        ) : (
          <Animated.View
            entering={FadeInDown.delay(120).duration(340)}
            style={[styles.note, { borderColor: c.border }]}
          >
            <Icon name="compass" size={18} color={c.textMuted} />
            <VText variant="callout" secondary style={{ flex: 1 }}>
              You skipped the subjects, so nothing gets a lift yet. Your feed will lean on
              freshness until you tell it otherwise.
            </VText>
          </Animated.View>
        )}

        <Animated.View
          entering={FadeInDown.delay(120 + picked.length * 55).duration(340)}
          style={[styles.presetRow, { backgroundColor: c.surfaceElevated }]}
        >
          <View style={[styles.presetMark, { backgroundColor: c.volt }]}>
            <Icon name="sliders" size={16} color={c.onVolt} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <VText variant="bodyMedium">{preset.label}</VText>
            <VText variant="caption" secondary>
              {preset.blurb}
            </VText>
          </View>
        </Animated.View>

        {choice.less.length > 0 ? (
          <Animated.View entering={FadeIn.delay(400).duration(340)}>
            <VText variant="caption" muted>
              {choice.less.length} {choice.less.length === 1 ? 'subject is' : 'subjects are'} turned
              down — pushed lower, never hidden.
            </VText>
          </Animated.View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.base, backgroundColor: c.bg }]}>
        <VText variant="micro" muted style={{ textAlign: 'center' }}>
          Every part of this is editable, whenever you like.
        </VText>
        <Button
          label="Open Vybe"
          onPress={() => {
            haptic('success');
            applySetup(choice);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '31.5%',
    flexGrow: 1,
    aspectRatio: 1.25,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: space.sm,
  },
  tileLabel: { zIndex: 1, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },

  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },

  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.xl,
  },
  presetMark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
  },
});
