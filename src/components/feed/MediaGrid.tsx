import React, { useCallback, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image, type ImageLoadEventData } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Icon, Touchable, VText, haptic } from '@/components/ui';
import { MediaPeek } from '@/components/feed/MediaPeek';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, spring } from '@/theme/tokens';
import type { PostKind } from '@/data/types';

const RATIO_MIN = 0.62;
const RATIO_MAX = 1.91;
const RATIO_FALLBACK = 1.25;

const ratios = new Map<string, number>();

const GAP = 2;
const GRID_RATIO = 1.55;

type Props = {
  media: string[];
  postId: string;
  kind: PostKind;
  onDoubleTapLike: () => void;
};

export function MediaGrid({ media, postId, kind, onDoubleTapLike }: Props) {
  const [peek, setPeek] = useState<{ uri: string; aspect: number } | null>(null);

  const shown = media.slice(0, 4);
  const overflow = media.length - shown.length;

  const tile = (uri: string, i: number, extra?: React.ReactNode) => (
    <MediaTile
      key={`${uri}-${i}`}
      uri={uri}
      postId={postId}
      index={i}
      kind={kind}
      single={media.length === 1}
      onDoubleTapLike={onDoubleTapLike}
      onPeek={setPeek}
      overlay={extra}
    />
  );

  return (
    <View style={styles.frame}>
      {shown.length === 1 ? (
        tile(shown[0], 0)
      ) : shown.length === 2 ? (
        <View style={[styles.row, { aspectRatio: GRID_RATIO }]}>
          {shown.map((m, i) => (
            <View key={`${m}-${i}`} style={styles.cell}>
              {tile(m, i)}
            </View>
          ))}
        </View>
      ) : shown.length === 3 ? (
        <View style={[styles.row, { aspectRatio: GRID_RATIO }]}>
          <View style={styles.cell}>{tile(shown[0], 0)}</View>
          <View style={[styles.cell, styles.column]}>
            <View style={styles.cell}>{tile(shown[1], 1)}</View>
            <View style={styles.cell}>{tile(shown[2], 2)}</View>
          </View>
        </View>
      ) : (
        <View style={[styles.row, { aspectRatio: GRID_RATIO }]}>
          <View style={[styles.cell, styles.column]}>
            <View style={styles.cell}>{tile(shown[0], 0)}</View>
            <View style={styles.cell}>{tile(shown[2], 2)}</View>
          </View>
          <View style={[styles.cell, styles.column]}>
            <View style={styles.cell}>{tile(shown[1], 1)}</View>
            <View style={styles.cell}>
              {tile(shown[3], 3, overflow > 0 ? <Overflow n={overflow} /> : null)}
            </View>
          </View>
        </View>
      )}

      <MediaPeek uri={peek?.uri ?? null} aspect={peek?.aspect} />
    </View>
  );
}

function Overflow({ n }: { n: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.overflow]} pointerEvents="none">
      <VText variant="title" color="#FFFFFF">
        +{n}
      </VText>
    </View>
  );
}

function MediaTile({
  uri,
  postId,
  index,
  kind,
  single,
  onDoubleTapLike,
  onPeek,
  overlay,
}: {
  uri: string;
  postId: string;
  index: number;
  kind: PostKind;
  single: boolean;
  onDoubleTapLike: () => void;
  onPeek: (v: { uri: string; aspect: number } | null) => void;
  overlay?: React.ReactNode;
}) {
  const { c } = useTheme();
  const router = useRouter();
  const [ratio, setRatio] = useState<number | undefined>(ratios.get(uri));
  const [error, setError] = useState(false);

  const held = useSharedValue(0);
  const burst = useSharedValue(0);

  const heldStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - held.value * 0.03 }],
  }));
  const burstStyle = useAnimatedStyle(() => ({
    transform: [{ scale: burst.value }],
    opacity: burst.value > 0 ? 1 : 0,
  }));

  const onLoad = useCallback(
    (e: ImageLoadEventData) => {
      const { width, height } = e.source ?? {};
      if (!width || !height) return;
      const r = width / height;
      ratios.set(uri, r);
      setRatio(r);
    },
    [uri],
  );

  const open = useCallback(() => {
    router.push(`/photo/${postId}?index=${index}`);
  }, [router, postId, index]);

  const like = useCallback(() => {
    haptic('medium');
    burst.value = 0;
    burst.value = withSequence(
      withSpring(1.25, spring.snappy),
      withDelay(380, withTiming(0, { duration: 220 })),
    );
    onDoubleTapLike();
  }, [burst, onDoubleTapLike]);

  const startPeek = useCallback(() => {
    haptic('medium');
    onPeek({ uri, aspect: ratios.get(uri) ?? ratio ?? RATIO_FALLBACK });
  }, [onPeek, uri, ratio]);

  const endPeek = useCallback(() => {
    onPeek(null);
  }, [onPeek]);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(250)
    .maxDistance(10)
    .cancelsTouchesInView(false)
    .onEnd((_e, ok) => {
      if (ok) runOnJS(like)();
    });

  const longPress = Gesture.LongPress()
    .minDuration(350)
    .maxDistance(10)
    .cancelsTouchesInView(false)
    .shouldCancelWhenOutside(true)
    .onStart(() => {
      held.value = withSpring(1, spring.snappy);
      runOnJS(startPeek)();
    })
    .onFinalize(() => {
      held.value = withSpring(0, spring.gentle);
      runOnJS(endPeek)();
    });

  const singleTap = Gesture.Tap()
    .maxDuration(250)
    .maxDistance(10)
    .cancelsTouchesInView(false)
    .onEnd((_e, ok) => {
      if (ok) runOnJS(open)();
    });

  const gesture = Gesture.Exclusive(doubleTap, longPress, singleTap);

  const natural = ratio ?? RATIO_FALLBACK;
  const clamped = Math.min(RATIO_MAX, Math.max(RATIO_MIN, natural));
  const shape = single ? { width: '100%' as const, aspectRatio: clamped } : styles.fill;
  const fit = single && ratio && (ratio < RATIO_MIN || ratio > RATIO_MAX) ? 'contain' : 'cover';

  const content = (
    <Animated.View
      accessible
      accessibilityRole="imagebutton"
      accessibilityLabel={`Photo ${index + 1}. Tap to open, hold to preview, double tap to like.`}
      style={[
        shape,
        styles.tile,
        { backgroundColor: c.bgSubtle },
        Platform.select({
          web: { touchAction: 'pan-y' } as any,
          default: null,
        }),
        heldStyle,
      ]}
    >
      {fit === 'contain' ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={28}
          cachePolicy="memory-disk"
          pointerEvents="none"
        />
      ) : null}

      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={fit}
        transition={140}
        cachePolicy="memory-disk"
        onLoad={onLoad}
        onError={() => setError(true)}
      />

      {error ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Icon name="image" size={26} color={c.textMuted} />
        </View>
      ) : null}

      {kind === 'video' ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={styles.play}>
            <Icon name="play" size={26} color="#FFFFFF" />
          </View>
        </View>
      ) : null}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, burstStyle]}>
        <View style={styles.burstGlow}>
          <Icon name="heart" size={88} color="#FF2D55" />
        </View>
      </Animated.View>

      {overlay}
    </Animated.View>
  );

  // On Web: wrap with standard Touchable to preserve native browser touch-action scrolling
  if (Platform.OS === 'web') {
    return (
      <Touchable
        onPress={open}
        feedback="none"
        scaleTo={1}
        style={[shape, { touchAction: 'pan-y' } as any]}
      >
        {content}
      </Touchable>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      {content}
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: GAP, width: '100%' },
  column: { flexDirection: 'column', gap: GAP },
  cell: { flex: 1, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tile: { overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  play: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  overflow: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  burstGlow: {
    shadowColor: '#FF2D55',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 10,
  },
});