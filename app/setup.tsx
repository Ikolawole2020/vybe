import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, space } from '@/theme/tokens';
import { TOPICS } from '@/data/topics';
import type { TopicId } from '@/data/types';
import { SETUP_PRESETS, type SetupPreset } from '@/store/useVybe';
import { useAuth } from '@/store/useAuth';

const STEPS = 3;

/**
 * First-run algorithm setup.
 *
 * This is the screen that makes the product's claim true: nothing reaches the
 * feed that the user did not put there. Three questions, in the order they
 * matter — what you want, what you do not, and how hard the thing should try.
 *
 * The six dials are deliberately not shown here. They are the right control
 * for someone who already knows what `serendipity` does to a ranking and the
 * wrong one for someone who has been in the app for nine seconds, so setup
 * picks a whole dial set by temperament and Your Algo exposes every knob
 * afterwards.
 */
export default function SetupScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const name = useAuth((s) => {
    const meta = s.user?.user_metadata as { display_name?: string } | undefined;
    return meta?.display_name?.split(' ')[0] ?? '';
  });

  const [step, setStep] = useState(0);
  const [more, setMore] = useState<TopicId[]>([]);
  const [less, setLess] = useState<TopicId[]>([]);
  const [preset, setPreset] = useState<SetupPreset>('balanced');

  // Step two only offers what step one did not claim, so a topic can never be
  // turned up and down at the same time.
  const remaining = useMemo(() => TOPICS.filter((t) => !more.includes(t.id)), [more]);

  const canAdvance = true;

  const next = () => {
    haptic('medium');
    if (step < STEPS - 1) {
      setStep(step + 1);
      return;
    }
    // The choice is carried to the next screen rather than committed here.
    // `personalizing` is what calls `applySetup`, so the flag that closes this
    // guard flips at the end of that animation instead of underneath it.
    router.push({
      pathname: '/personalizing' as any,
      params: { more: more.join(','), less: less.join(','), preset },
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg }}>
        <View style={styles.progress}>
          {Array.from({ length: STEPS }, (_, i) => (
            <Animated.View
              key={i}
              layout={LinearTransition.springify()}
              style={[
                styles.tick,
                { backgroundColor: i <= step ? c.volt : c.surfaceElevated, flex: i === step ? 2 : 1 },
              ]}
            />
          ))}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xxl + 16,
          gap: space.lg,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={{ gap: space.lg }}>
            <Header
              title={name ? `What are you into, ${name}?` : 'What are you into?'}
              blurb="Pick as many as you like. These are the only topics that get a lift — everything else stays neutral until you say otherwise."
            />
            <TopicGrid topics={TOPICS} selected={more} onToggle={(id) => setMore(toggle(more, id))} />
          </Animated.View>
        ) : null}

        {step === 1 ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={{ gap: space.lg }}>
            <Header
              title="Anything you would rather not see?"
              blurb={
                remaining.length > 0
                  ? 'These get pushed down, not blocked. You can skip this — most people do, then come back after a week of being annoyed by something.'
                  : 'You have chosen to include all topics in your feed.'
              }
            />
            {remaining.length > 0 ? (
              <TopicGrid
                topics={remaining}
                selected={less}
                tone="down"
                onToggle={(id) => setLess(toggle(less, id))}
              />
            ) : (
              <View
                style={[
                  styles.allSelectedCard,
                  { backgroundColor: c.surfaceElevated, borderColor: c.border },
                ]}
              >
                <Icon name="check-circle" size={24} color={c.volt} />
                <View style={{ flex: 1, gap: 4 }}>
                  <VText variant="heading">You're interested in everything</VText>
                  <VText variant="caption" secondary>
                    You selected all available topics in the previous step. Nothing is left to push down. Tap Next to choose your feed temperament.
                  </VText>
                </View>
              </View>
            )}
          </Animated.View>
        ) : null}

        {step === 2 ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={{ gap: space.lg }}>
            <Header
              title="How hard should it try?"
              blurb="This sets all six ranking dials at once. Your Algo lets you move each one by hand afterwards."
            />
            <View style={{ gap: space.md }}>
              {(Object.keys(SETUP_PRESETS) as SetupPreset[]).map((key) => (
                <PresetCard
                  key={key}
                  id={key}
                  active={preset === key}
                  onPress={() => {
                    setPreset(key);
                  }}
                />
              ))}
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + space.base, backgroundColor: c.bg },
        ]}
      >
        {step > 0 ? (
          <Touchable
            onPress={() => setStep(step - 1)}
            feedback="light"
            scaleTo={0.92}
            accessibilityLabel="Back"
            style={[styles.back, { backgroundColor: c.surfaceElevated }]}
          >
            <Icon name="arrow-left" size={20} color={c.text} />
          </Touchable>
        ) : null}

        <Button
          label={step === STEPS - 1 ? 'Build my feed' : 'Next'}
          onPress={next}
          disabled={!canAdvance}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

function toggle(list: TopicId[], id: TopicId) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Header({ title, blurb }: { title: string; blurb: string }) {
  return (
    <View style={{ gap: space.sm }}>
      <VText variant="hero">{title}</VText>
      <VText variant="body" secondary>
        {blurb}
      </VText>
    </View>
  );
}

/**
 * Topics as a grid of photographs.
 *
 * This was twenty-two identical grey pills with a wire icon on each, which is a
 * form rather than a choice: nothing distinguishes one option from the next
 * until you read it, so picking six meant reading twenty-two labels. A picture
 * of the subject is recognised before it is read, and the grid becomes
 * scannable.
 *
 * Three deliberate choices in how the selected state is drawn:
 *
 * - **The photo stays visible when selected.** Covering it with a flat fill
 *   throws away the thing that made the tile identifiable, and a grid of solid
 *   volt squares is unreadable. Selection is a ring, a check, and the scrim
 *   lifting — the picture gets *brighter*, which is the right direction for
 *   "yes, more of this".
 * - **`tone` still flips the accent.** Volt means "more" everywhere else in the
 *   app, so the reject step marks with ember instead of teaching the accent two
 *   opposite meanings. On the reject step the scrim goes the other way and the
 *   photo dims, which is the honest visual for pushing something down.
 * - **A gradient scrim, not a flat overlay.** The label sits over the bottom
 *   third of a photograph whose brightness is unknown, and flat dimming either
 *   loses the image or loses the text. The scrim is transparent at the top and
 *   near-opaque behind the words.
 */
function TopicGrid({
  topics,
  selected,
  onToggle,
  tone = 'up',
}: {
  topics: typeof TOPICS;
  selected: TopicId[];
  onToggle: (id: TopicId) => void;
  tone?: 'up' | 'down';
}) {
  const { c } = useTheme();
  const accent = tone === 'up' ? c.volt : c.ember;
  const ink = tone === 'up' ? c.onVolt : '#FFFFFF';

  return (
    <View style={styles.grid}>
      {topics.map((t) => {
        const on = selected.includes(t.id);
        const dimmed = on && tone === 'down';

        return (
          <Touchable
            key={t.id}
            onPress={() => onToggle(t.id)}
            feedback="select"
            scaleTo={0.95}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t.label}
            style={[
              styles.tile,
              {
                borderColor: on ? accent : 'transparent',
                // `hue` shows through while the photo loads and stands in
                // permanently for any topic without art, so a tile is never a
                // grey hole.
                backgroundColor: t.hue,
              },
            ]}
          >
            {t.image ? (
              <Image
                source={{ uri: t.image }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                // The flat hue is the placeholder, so there is no fade from
                // white on a dark screen.
                placeholder={{ blurhash: undefined }}
                transition={220}
                // Twenty-two remote images on one screen, re-downloaded on every
                // visit without this.
                cachePolicy="memory-disk"
                recyclingKey={t.id}
              />
            ) : (
              <View style={styles.tileGlyph}>
                <Icon name={t.glyph as any} size={22} color="rgba(255,255,255,0.85)" />
              </View>
            )}

            <LinearGradient
              colors={
                dimmed
                  ? ['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']
                  : on
                    ? ['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.65)']
                    : ['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.78)']
              }
              style={StyleSheet.absoluteFill}
            />

            {on ? (
              <View style={[styles.tileCheck, { backgroundColor: accent }]}>
                <Icon name={tone === 'up' ? 'check' : 'minus'} size={13} color={ink} />
              </View>
            ) : null}

            <VText
              variant="label"
              color="#FFFFFF"
              numberOfLines={2}
              style={styles.tileLabel}
            >
              {t.label}
            </VText>
          </Touchable>
        );
      })}
    </View>
  );
}

function PresetCard({
  id,
  active,
  onPress,
}: {
  id: SetupPreset;
  active: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();
  const meta = SETUP_PRESETS[id];

  return (
    <Touchable
      onPress={onPress}
      feedback="select"
      scaleTo={0.98}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${meta.label}. ${meta.blurb}`}
      style={[
        styles.preset,
        active && shadow.card,
        { backgroundColor: active ? c.volt : c.surfaceElevated },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <VText variant="heading" color={active ? c.onVolt : c.text}>
          {meta.label}
        </VText>
        <VText
          variant="caption"
          color={active ? c.onVolt : c.textSecondary}
          style={active ? { opacity: 0.75 } : undefined}
        >
          {meta.blurb}
        </VText>
      </View>
      <Icon
        name={active ? 'check-circle' : 'circle'}
        size={20}
        color={active ? c.onVolt : c.textMuted}
      />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, height: 4 },
  tick: { height: 4, borderRadius: 2 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    // Three across on a 390pt phone, two on a small one — `flexBasis` with a
    // percentage rather than a measured width, so it reflows on rotation and on
    // a tablet without anything recomputing.
    flexBasis: '31.5%',
    flexGrow: 1,
    aspectRatio: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    padding: space.sm,
    borderWidth: 2,
  },
  tileGlyph: {
    ...(StyleSheet.absoluteFill as object),
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    // Above the gradient, which is absolutely positioned over the photo.
    zIndex: 1,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowRadius: 4,
  },
  tileCheck: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },

  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.base,
    padding: space.base,
    borderRadius: radius.xl,
  },

  allSelectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.base,
    padding: space.lg,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  back: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
