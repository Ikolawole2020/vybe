import React, { useEffect, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Icon, Touchable, VText, haptic } from '@/components/ui';
import { space, spring } from '@/theme/tokens';
import { useVybe } from '@/store/useVybe';
import { fetchPostsByIds } from '@/services/db';
import type { Post } from '@/data/types';

const { width: W, height: H } = Dimensions.get('window');
const MAX_SCALE = 4;

/**
 * Full-screen photo.
 *
 * Always black regardless of theme — a photo viewer's ground is not part of the
 * app's palette, it is the absence of one, and a pale surround changes how the
 * image itself reads.
 */
export default function PhotoScreen() {
  const insets = useSafeAreaInsets();
  const { id, index, uri } = useLocalSearchParams<{ id: string; index?: string; uri?: string }>();

  /**
   * The post may not be in the feed window — reached from a link, or from
   * something saved long enough ago to have aged out of it. Falling back to a
   * fetch is the difference between the photos opening and a black screen.
   */
  const known = useVybe((s) => (uri ? undefined : s.posts.find((p) => p.id === id)));
  const [fetched, setFetched] = useState<Post | null>(null);

  useEffect(() => {
    if (uri || !id || known || fetched) return;
    let live = true;
    void fetchPostsByIds([id]).then((found) => {
      if (live && found[0]) setFetched(found[0]);
    });
    return () => {
      live = false;
    };
  }, [id, uri, known, fetched]);

  const post = known ?? fetched;
  const media = uri ? [uri] : post?.media ?? [];
  const start = Math.min(Math.max(Number(index ?? 0), 0), Math.max(media.length - 1, 0));
  const [page, setPage] = useState(start);

  /**
   * Paging is suspended while a photo is zoomed in.
   *
   * Otherwise a drag across a magnified photo is ambiguous — pan the image, or
   * flick to the next one? — and the pager wins, which makes zoom useless on
   * anything wider than the screen.
   */
  const [zoomed, setZoomed] = useState(false);

  /**
   * Swipe down to leave, as in the story viewer.
   *
   * Tapping a photo in the feed opened this and the only ways back were the X
   * in the corner and a tap on the image — and a tap is easy to spend by
   * accident when what you meant was a small drag. The photo follows the
   * finger, the black ground fades to let the feed show through behind it, and
   * an uncommitted pull springs back.
   *
   * Three guards keep it out of everything else's way: `activeOffsetY` means
   * only a downward pull claims it, `failOffsetX` hands sideways drags to the
   * pager, and it is disabled outright while zoomed, where a drag means pan.
   */
  const dragY = useSharedValue(0);
  const dismiss = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-9999, 14])
    .failOffsetX([-24, 24])
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (dragY.value > 130 || e.velocityY > 900) {
        runOnJS(haptic)('light');
        runOnJS(goBack)();
        return;
      }
      dragY.value = withSpring(0, spring.snappy);
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dragY.value },
      { scale: Math.max(0.86, 1 - dragY.value / 1200) },
    ],
  }));

  // The ground fades separately from the photo, so what you are dropping back
  // into is visible while you decide.
  const groundStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - dragY.value / 420),
  }));

  if (!media.length) return <View style={styles.page} />;

  return (
    <View style={styles.transparentPage}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.ground, groundStyle]} />

      <GestureDetector gesture={dismiss}>
        <Animated.View style={[{ flex: 1 }, dragStyle]}>
          <ScrollView
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: start * W, y: 0 }}
            onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}
          >
            {media.map((m) => (
              <Zoomable key={m} uri={m} zoomed={zoomed} onZoomChange={setZoomed} />
            ))}
          </ScrollView>
        </Animated.View>
      </GestureDetector>

      <Touchable
        onPress={() => goBack()}
        feedback="light"
        hitSlop={12}
        accessibilityLabel="Close"
        style={[styles.close, { top: insets.top + space.sm }]}
      >
        <Icon name="x" size={22} color="#FFFFFF" />
      </Touchable>

      {media.length > 1 ? (
        <View style={[styles.count, { bottom: insets.bottom + space.lg }]}>
          <VText variant="micro" color="#FFFFFF">
            {page + 1} of {media.length}
          </VText>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One photo, pinchable.
 *
 * Pinch to any scale up to 4×, drag to move around once you are in, double tap
 * to jump to 2.5× and back out again. Letting go below 1× springs back to fit
 * rather than leaving the photo stranded at 0.7 — the rubber-band that every
 * photo viewer has and whose absence reads immediately as broken.
 *
 * A single tap still closes, which is the gesture everyone tries first; it is
 * gated behind the double tap so that zooming never dismisses by accident.
 */
function Zoomable({
  uri,
  zoomed,
  onZoomChange,
}: {
  uri: string;
  /** Panning the photo is only meaningful once there is more of it than fits. */
  zoomed: boolean;
  onZoomChange: (v: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const reset = () => {
    'worklet';
    scale.value = withSpring(1, spring.gentle);
    savedScale.value = 1;
    x.value = withSpring(0, spring.gentle);
    y.value = withSpring(0, spring.gentle);
    savedX.value = 0;
    savedY.value = 0;
    runOnJS(onZoomChange)(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(0.6, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        reset();
      } else {
        savedScale.value = scale.value;
        runOnJS(onZoomChange)(true);
      }
    });

  /**
   * Only live while zoomed in — and that is not a nicety, it is the fix for
   * swipe-to-dismiss doing nothing.
   *
   * This gesture used to be enabled always and bail out inside `onUpdate` when
   * the photo was at rest. Bailing out is not the same as not participating:
   * being a descendant detector, it won the drag against the dismiss gesture
   * on the ancestor, and then deliberately ignored it. Every downward swipe was
   * captured by a handler that had already decided to do nothing with it.
   */
  const pan = Gesture.Pan()
    .enabled(zoomed)
    // One finger only: two-finger drags belong to the pinch.
    .maxPointers(1)
    .onUpdate((e) => {
      if (savedScale.value <= 1) return;
      // The further in you are, the further the photo may travel off-centre.
      const bound = ((savedScale.value - 1) * W) / 2 + 40;
      const boundY = ((savedScale.value - 1) * H) / 2 + 40;
      x.value = Math.min(bound, Math.max(-bound, savedX.value + e.translationX));
      y.value = Math.min(boundY, Math.max(-boundY, savedY.value + e.translationY));
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((_e, ok) => {
      if (!ok) return;
      runOnJS(haptic)('light');
      if (savedScale.value > 1) {
        reset();
      } else {
        scale.value = withTiming(2.5, { duration: 200 });
        savedScale.value = 2.5;
        runOnJS(onZoomChange)(true);
      }
    });

  const singleTap = Gesture.Tap()
    .maxDuration(260)
    .onEnd((_e, ok) => {
      if (!ok) return;
      // Zoomed in, a stray tap should not throw away where you are.
      if (savedScale.value > 1) return;
      runOnJS(goBack)();
    });

  const gesture = Gesture.Race(
    Gesture.Simultaneous(pinch, pan),
    Gesture.Exclusive(doubleTap, singleTap),
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={{ width: W, height: H }}>
        <Animated.View style={[{ width: W, height: H }, style]}>
          <Image
            source={{ uri }}
            style={{ width: W, height: H }}
            contentFit="contain"
            transition={160}
          />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000000' },
  // The ground is a separate layer so it can fade under the drag; the page
  // itself has to be transparent for that fade to reveal anything.
  transparentPage: { flex: 1 },
  ground: { backgroundColor: '#000000' },
  close: {
    position: 'absolute',
    right: space.base,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  count: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
});
