import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { AmbientAura } from '@/components/AmbientAura';
import { Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { Glass } from '@/components/glass/Glass';
import { alpha, radius, space, spring } from '@/theme/tokens';
import { useVybe } from '@/store/useVybe';
import { useAuth } from '@/store/useAuth';

const { width: W } = Dimensions.get('window');

type Slide = {
  kicker: string;
  title: string;
  body: string;
  figure: 'masthead' | 'dials' | 'ledger' | 'circles' | 'budget';
};

const SLIDES: Slide[] = [
  {
    kicker: 'Welcome',
    title: 'Your feed,\nyour rules.',
    body: 'Vybe has no engagement model and nothing to sell you. What you see is decided by six numbers, and every one of them is yours to set.',
    figure: 'masthead',
  },
  {
    kicker: 'Your Algo',
    title: 'Six dials.\nNo secrets.',
    body: 'Recency, circles, topics, depth, discovery, crowd. Move one and the feed re-ranks in front of you — no save button, no reload.',
    figure: 'dials',
  },
  {
    kicker: 'Receipts',
    title: 'Every post\nshows its work.',
    body: 'Open any post and you get the actual arithmetic that ranked it — each signal, each weight, and the total. Not a summary of it. It.',
    figure: 'ledger',
  },
  {
    kicker: 'Circles',
    title: 'Different people,\ndifferent rooms.',
    body: 'Group who you follow, then decide per post who can see it and who can reply. Audience and interaction are separate questions.',
    figure: 'circles',
  },
  {
    kicker: 'Attention Budget',
    title: 'It stops\nwhen you do.',
    body: 'Set a daily limit. Past it the feed quietly desaturates and stops trying to be interesting. Nothing locks — Vybe just takes the hint.',
    figure: 'budget',
  },
];

/**
 * Five swipeable pages.
 *
 * Each page pairs a live-looking panel with the claim it demonstrates — the
 * panels are built from the same components as the real screens, so the tour
 * shows the product rather than an illustration of it.
 */
export default function TourScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const completeTour = useVybe((s) => s.completeTour);

  const scrollRef = useRef<Animated.ScrollView>(null);
  const x = useSharedValue(0);
  const [page, setPage] = useState(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      x.value = e.contentOffset.x;
    },
  });

  // `onMomentumScrollEnd` does not fire for a programmatic `scrollTo`, so the
  // buttons have to move `page` themselves. Leaving it to the scroll handler
  // strands the state on 0 after the first tap: every later tap recomputes
  // `goTo(0 + 1)` and scrolls to the page already on screen, and `last` never
  // becomes true so the final button never appears.
  const goTo = useCallback((i: number) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, i));
    setPage(next);
    scrollRef.current?.scrollTo({ x: next * W, animated: true });
  }, []);

  // Finishing the tour only sets the tour's own flag. Where that leads —
  // sign-up, setup, or straight back to the feed on a replay — is the root
  // layout's decision, and duplicating it here is how the two drift apart.
  const finish = useCallback(() => {
    haptic('success');

    // Sign-up is the right landing for a first run — somebody has just been
    // told what this is and has no account. It is the wrong one for somebody
    // who was on sign-in, stepped back here to re-read the pitch, and pressed
    // Skip; `tourExitScreen` is how that trip says so. Spent immediately, so it
    // never colours the next visit.
    const auth = useAuth.getState();
    auth.setAuthInitialScreen(auth.tourExitScreen ?? 'sign-up');
    auth.setTourExitScreen(null);

    completeTour();
  }, [completeTour]);

  const last = page === SLIDES.length - 1;

  return (
    <View style={{ flex: 1 }}>
      <AmbientAura />

      <View style={[styles.folio, { top: insets.top + space.sm }]}>
        <View style={{ flex: 1 }} />
        {!last ? (
          <Touchable
            onPress={finish}
            feedback="light"
            scaleTo={1}
            hitSlop={12}
            accessibilityLabel="Skip the tour"
            style={styles.skip}
          >
            <VText variant="label" muted>
              Skip
            </VText>
          </Touchable>
        ) : null}
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / W);
          if (next !== page) {
            setPage(next);
            haptic('select');
          }
        }}
      >
        {SLIDES.map((s, i) => (
          <Page key={s.kicker} slide={s} index={i} x={x} top={insets.top} />
        ))}
      </Animated.ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.base, backgroundColor: c.bg }]}>
        <Progress count={SLIDES.length} x={x} />

        <View style={styles.controls}>
          <Glass variant="regular" radius={radius.pill} style={styles.back}>
            <Touchable
              onPress={() => goTo(page - 1)}
              disabled={page === 0}
              feedback="light"
              accessibilityLabel="Previous page"
              style={styles.backInner}
            >
              <Icon name="arrow-left" size={20} color={page === 0 ? c.textMuted : c.text} />
            </Touchable>
          </Glass>

          <Button
            label={last ? 'Start using Vybe' : 'Next'}
            onPress={last ? finish : () => goTo(page + 1)}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- page ---- */

function Page({
  slide,
  index,
  x,
  top,
}: {
  slide: Slide;
  index: number;
  x: SharedValue<number>;
  top: number;
}) {
  const { c } = useTheme();
  const range = [(index - 1) * W, index * W, (index + 1) * W];

  // The plate travels faster than the text, so the two layers separate as you
  // swipe. No scaling and no fading of the ground — just parallax, which is
  // the one motion a turning page actually has.
  const figureStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, range, [0, 1, 0], 'clamp'),
    transform: [{ translateX: interpolate(x.value, range, [W * 0.3, 0, -W * 0.3], 'clamp') }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, range, [0, 1, 0], 'clamp'),
    transform: [{ translateX: interpolate(x.value, range, [W * 0.12, 0, -W * 0.12], 'clamp') }],
  }));

  return (
    <View style={[styles.page, { paddingTop: top + space.xxl }]}>
      <Animated.View style={[styles.plate, figureStyle]}>
        <Figure kind={slide.figure} />
      </Animated.View>

      <Animated.View style={[styles.copy, textStyle]}>
        <View style={[styles.kicker, { backgroundColor: c.primaryDim }]}>
          <VText variant="micro" color={c.primary}>
            {slide.kicker}
          </VText>
        </View>
        <VText variant="mega">{slide.title}</VText>
        <VText variant="body" secondary>
          {slide.body}
        </VText>
      </Animated.View>
    </View>
  );
}

/* --------------------------------------------------------------- plates ---- */

function Figure({ kind }: { kind: Slide['figure'] }) {
  switch (kind) {
    case 'masthead':
      return <MastheadPlate />;
    case 'dials':
      return <DialsPlate />;
    case 'ledger':
      return <LedgerPlate />;
    case 'circles':
      return <CirclesPlate />;
    case 'budget':
      return <BudgetPlate />;
  }
}

function MastheadPlate() {
  return (
    // The promise is the figure. An app icon says nothing the wordmark above
    // it has not already said, so the two claims carry the plate instead.
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <Pill label="No ads" />
      <Pill label="No ranking you did not set" />
      <Pill label="Nothing you cannot turn off" />
    </View>
  );
}

function Pill({ label }: { label: string }) {
  const { c } = useTheme();
  return (
    <View style={[styles.pill, { borderColor: c.border }]}>
      <Icon name="check" size={13} color={c.cyan} />
      <VText variant="caption" secondary>
        {label}
      </VText>
    </View>
  );
}

const DIALS = [
  { label: 'Recency', v: 0.72 },
  { label: 'Circles', v: 0.9 },
  { label: 'Topics', v: 0.6 },
  { label: 'Depth', v: 0.44 },
  { label: 'Discovery', v: 0.3 },
  { label: 'Crowd', v: 0.08 },
];

function DialsPlate() {
  const { c } = useTheme();
  const grow = useSharedValue(0);
  React.useEffect(() => {
    grow.value = withSpring(1, spring.gentle);
  }, [grow]);

  return (
    <View style={[styles.panel, { backgroundColor: c.bgSubtle, borderColor: c.border }]}>
      {DIALS.map((d, i) => (
        <View key={d.label}>
          <View style={styles.dialRow}>
            <VText variant="label" secondary style={{ width: 82 }}>
              {d.label}
            </VText>
            <View style={[styles.dialTrack, { backgroundColor: c.bgSubtle }]}>
              <Bar value={d.v} grow={grow} fill={d.v < 0.1 ? c.textMuted : c.primary} />
            </View>
            <VText variant="numeric" muted style={{ width: 30, textAlign: 'right' }}>
              {Math.round(d.v * 100)}
            </VText>
          </View>
          {i < DIALS.length - 1 ? (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Bar({ value, grow, fill }: { value: number; grow: SharedValue<number>; fill: string }) {
  const style = useAnimatedStyle(() => ({
    width: `${interpolate(grow.value, [0, 1], [0, value * 100], 'clamp')}%`,
  }));
  return <Animated.View style={[styles.dialFill, { backgroundColor: fill }, style]} />;
}

const FACTORS = [
  { label: 'In your Inner circle', v: '+0.42' },
  { label: 'Topic: photography', v: '+0.31' },
  { label: 'Posted 40m ago', v: '+0.18' },
  { label: 'Crowd signal', v: ' 0.00' },
];

function LedgerPlate() {
  const { c } = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: c.bgSubtle, borderColor: c.border }]}>
      <VText variant="label" muted style={{ marginBottom: space.sm }}>
        Why you saw this
      </VText>
      {FACTORS.map((f) => (
        <View key={f.label} style={styles.factorRow}>
          <VText variant="caption" secondary style={{ flex: 1 }}>
            {f.label}
          </VText>
          <VText variant="numeric" color={f.v.trim() === '0.00' ? c.textMuted : c.text}>
            {f.v}
          </VText>
        </View>
      ))}
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginTop: space.sm }} />
      <View style={[styles.factorRow, { marginTop: space.sm }]}>
        <VText variant="bodyMedium" style={{ flex: 1 }}>
          Score
        </VText>
        <VText variant="subheading" color={c.primary}>
          +0.91
        </VText>
      </View>
    </View>
  );
}

/** Visibility drawn as nested frames — the print way to show containment. */
function CirclesPlate() {
  const { c } = useTheme();
  const rings = [
    { label: 'Everyone', pad: 0 },
    { label: 'Followers', pad: 24 },
    { label: 'Inner circle', pad: 48 },
  ];
  return (
    <View style={{ width: '100%', height: 220 }}>
      {rings.map((r, i) => (
        <View
          key={r.label}
          style={[
            styles.frame,
            {
              top: r.pad,
              left: r.pad,
              right: r.pad,
              bottom: r.pad,
              borderColor: i === rings.length - 1 ? c.primary : c.border,
              borderWidth: i === rings.length - 1 ? 2 : StyleSheet.hairlineWidth,
              borderRadius: radius.xl,
              backgroundColor: i === rings.length - 1 ? alpha(c.primary, 0.1) : 'transparent',
            },
          ]}
        >
          <VText
            variant="micro"
            color={i === rings.length - 1 ? c.primary : c.textMuted}
            style={[styles.frameLabel, { backgroundColor: c.bg }]}
          >
            {r.label}
          </VText>
        </View>
      ))}
    </View>
  );
}

/** A tick-marked gauge. A bar with a scale reads as a measurement, not a toy. */
function BudgetPlate() {
  const { c } = useTheme();
  const spent = 22 / 30;
  return (
    <View style={[styles.panel, { backgroundColor: c.bgSubtle, borderColor: c.border }]}>
      <View style={styles.gaugeHead}>
        <VText variant="label" muted>
          Today
        </VText>
        <View style={{ flex: 1 }} />
        <VText variant="subheading" color={c.primary}>
          22 / 30 min
        </VText>
      </View>
      <View style={[styles.gauge, { backgroundColor: c.bg }]}>
        <View
          style={{
            width: `${spent * 100}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: c.primary,
          }}
        />
      </View>
      <VText variant="caption" muted style={{ marginTop: space.sm }}>
        Past the limit the feed desaturates. Nothing locks.
      </VText>
    </View>
  );
}

/* ------------------------------------------------------------- progress ---- */

/** Segmented rules. The active segment fills continuously with the scroll. */
function Progress({ count, x }: { count: number; x: SharedValue<number> }) {
  const segs = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  return (
    <View style={styles.progress} accessible accessibilityLabel={`Tour progress, ${count} pages`}>
      {segs.map((i) => (
        <Segment key={i} index={i} x={x} />
      ))}
    </View>
  );
}

function Segment({ index, x }: { index: number; x: SharedValue<number> }) {
  const { c } = useTheme();
  const style = useAnimatedStyle(() => ({
    width: `${interpolate(x.value, [(index - 1) * W, index * W], [0, 1], 'clamp') * 100}%`,
  }));
  return (
    <View style={[styles.segTrack, { backgroundColor: c.border }]}>
      <Animated.View style={[styles.segFill, { backgroundColor: c.primary }, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: W, paddingHorizontal: space.lg, flex: 1, justifyContent: 'space-between' },

  folio: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  skip: { minWidth: 60, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },

  plate: { flex: 1, justifyContent: 'center' },
  panel: { width: '100%', borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: space.base },
  appMark: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },

  dialRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8 },
  dialTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  dialFill: { height: '100%', borderRadius: 4 },

  factorRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 5 },

  frame: { position: 'absolute' },
  frameLabel: { position: 'absolute', top: -8, left: 14, paddingHorizontal: 6 },

  gaugeHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  gauge: { height: 12, borderRadius: 999, overflow: 'hidden' },

  copy: { gap: space.md, paddingBottom: 190 },
  kicker: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    gap: space.md,
  },
  progress: { flexDirection: 'row', gap: 5, marginTop: space.md },
  segTrack: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  segFill: { height: '100%', borderRadius: 2 },

  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  back: { width: 56, height: 52, overflow: 'hidden' },
  backInner: { width: 56, height: 52, alignItems: 'center', justifyContent: 'center' },
});
