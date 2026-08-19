import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

/**
 * Crop, to whatever shape the photo wants to be.
 *
 * Uploading a story offered no crop at all: whatever came out of the picker was
 * what got posted, and the only control was a fit toggle that letterboxed the
 * whole frame against a blur. So a photo with a stranger at the edge, or three
 * inches of ceiling above the subject, could not be fixed inside the app.
 *
 * The frame here is **free by default** — drag any corner, drag the middle to
 * move the whole rectangle, and the result is exactly the rectangle you drew.
 * The ratio chips are shortcuts for the shapes people ask for often, not a
 * requirement; "Free" is the default and stays selected unless you pick one.
 *
 * Everything is computed in *display* points against the fitted image, then
 * mapped back to source pixels once, at the end, so the crop is as sharp as the
 * original rather than as sharp as the preview.
 */

const HANDLE = 34;
/** Never let the frame collapse to a line under a fast drag. */
const MIN_SIZE = 60;

type Ratio = { label: string; value: number | null };

const RATIOS: Ratio[] = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:5', value: 0.8 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

type Frame = { x: number; y: number; w: number; h: number };

export function CropStudio({
  uri,
  onCancel,
  onDone,
}: {
  uri: string;
  onCancel: () => void;
  /** Receives the cropped file's uri — the caller decides what to do with it. */
  onDone: (uri: string) => void;
}) {
  const { c } = useTheme();
  // Android draws its navigation bar over the bottom of the window, and the
  // chips and the hint were sitting underneath it.
  const insets = useSafeAreaInsets();

  const [source, setSource] = useState<{ width: number; height: number } | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [working, setWorking] = useState(false);

  // The image as drawn: fitted inside the stage, centred.
  const [fit, setFit] = useState<Frame | null>(null);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);

  useEffect(() => {
    let live = true;
    void Image.loadAsync(uri)
      .then((img) => {
        if (live && img?.width && img?.height) setSource({ width: img.width, height: img.height });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [uri]);

  // Fit the image into the stage, then start with the frame on the whole thing.
  useEffect(() => {
    if (!source || !stage) return;
    const scale = Math.min(stage.w / source.width, stage.h / source.height);
    const dw = source.width * scale;
    const dh = source.height * scale;
    const f = { x: (stage.w - dw) / 2, y: (stage.h - dh) / 2, w: dw, h: dh };
    setFit(f);
    x.value = f.x;
    y.value = f.y;
    w.value = f.w;
    h.value = f.h;
  }, [source, stage, x, y, w, h]);

  /** Snap the current frame into a ratio, keeping it centred and inside. */
  const applyRatio = useCallback(
    (r: number | null) => {
      haptic('select');
      setRatio(r);
      if (r == null || !fit) return;
      const maxW = fit.w;
      const maxH = fit.h;
      let nw = maxW;
      let nh = nw / r;
      if (nh > maxH) {
        nh = maxH;
        nw = nh * r;
      }
      x.value = fit.x + (maxW - nw) / 2;
      y.value = fit.y + (maxH - nh) / 2;
      w.value = nw;
      h.value = nh;
    },
    [fit, x, y, w, h],
  );

  const bounds = fit ?? { x: 0, y: 0, w: 0, h: 0 };

  // Dragging the middle moves the frame; it may not leave the image.
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const move = Gesture.Pan()
    .onStart(() => {
      startX.value = x.value;
      startY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = Math.min(
        bounds.x + bounds.w - w.value,
        Math.max(bounds.x, startX.value + e.translationX),
      );
      y.value = Math.min(
        bounds.y + bounds.h - h.value,
        Math.max(bounds.y, startY.value + e.translationY),
      );
    });

  const frameStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
  }));

  const confirm = async () => {
    if (!source || !fit || working) return;
    setWorking(true);
    haptic('success');
    try {
      // Display points → source pixels. One scale factor for both axes, since
      // the fit preserved the aspect ratio.
      const k = source.width / fit.w;
      const originX = Math.max(0, Math.round((x.value - fit.x) * k));
      const originY = Math.max(0, Math.round((y.value - fit.y) * k));
      const width = Math.min(source.width - originX, Math.round(w.value * k));
      const height = Math.min(source.height - originY, Math.round(h.value * k));

      const ctx = ImageManipulator.manipulate(uri);
      ctx.crop({ originX, originY, width, height });
      const rendered = await ctx.renderAsync();
      const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
      onDone(out.uri);
    } catch {
      // A crop that cannot be rendered must not strand the user on this screen
      // with a dead button — the uncropped original is still a valid story.
      onDone(uri);
    } finally {
      setWorking(false);
    }
  };

  return (
    <View style={styles.page}>
      <View style={[styles.bar, { paddingTop: space.sm }]}>
        <Touchable onPress={onCancel} feedback="light" style={styles.barBtn} accessibilityLabel="Cancel crop">
          <Icon name="x" size={22} color="#FFFFFF" />
        </Touchable>
        <VText variant="subheading" color="#FFFFFF">
          Crop
        </VText>
        <Touchable
          onPress={confirm}
          feedback="none"
          disabled={working || !fit}
          style={[styles.doneBtn, { backgroundColor: c.volt }]}
          accessibilityLabel="Use this crop"
        >
          {working ? (
            <ActivityIndicator color={c.onVolt} />
          ) : (
            <VText variant="label" color={c.onVolt}>
              Done
            </VText>
          )}
        </Touchable>
      </View>

      <View
        style={styles.stage}
        onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        {fit ? (
          <>
            {/*
              Spelled out rather than spread from `fit`.

              `fit` is `{x, y, w, h}` — the crop maths' own vocabulary, and not
              one of those four is a style prop. Spreading it handed the image
              four keys React Native ignores, so the photo laid out at zero by
              zero: the frame, the grid and the handles all drew correctly over
              a picture that was never on screen.
            */}
            <Image
              source={{ uri }}
              style={{ position: 'absolute', left: fit.x, top: fit.y, width: fit.w, height: fit.h }}
              contentFit="fill"
            />

            {/* Everything outside the frame dims. Four bands rather than a
                cut-out, which React Native has no way to express. */}
            <Shade x={x} y={y} w={w} h={h} stage={stage!} />

            <GestureDetector gesture={move}>
              <Animated.View style={[styles.frame, frameStyle, { borderColor: c.volt }]}>
                <Grid />
                <Corner corner="tl" x={x} y={y} w={w} h={h} bounds={bounds} ratio={ratio} color={c.volt} />
                <Corner corner="tr" x={x} y={y} w={w} h={h} bounds={bounds} ratio={ratio} color={c.volt} />
                <Corner corner="bl" x={x} y={y} w={w} h={h} bounds={bounds} ratio={ratio} color={c.volt} />
                <Corner corner="br" x={x} y={y} w={w} h={h} bounds={bounds} ratio={ratio} color={c.volt} />
              </Animated.View>
            </GestureDetector>
          </>
        ) : (
          <ActivityIndicator color="#FFFFFF" />
        )}
      </View>

      <View style={styles.ratios}>
        {RATIOS.map((r) => {
          const on = ratio === r.value;
          return (
            <Touchable
              key={r.label}
              onPress={() => applyRatio(r.value)}
              feedback="none"
              style={[
                styles.chip,
                { backgroundColor: on ? c.volt : 'rgba(255,255,255,0.12)' },
              ]}
              accessibilityLabel={`Crop ${r.label}`}
              accessibilityState={{ selected: on }}
            >
              <VText variant="micro" color={on ? c.onVolt : '#FFFFFF'}>
                {r.label}
              </VText>
            </Touchable>
          );
        })}
      </View>

      <VText
        variant="micro"
        color="rgba(255,255,255,0.55)"
        style={[styles.hint, { paddingBottom: Math.max(insets.bottom, space.md) }]}
      >
        Drag the corners for any shape. Free is the default.
      </VText>
    </View>
  );
}

/** The dimmed surround, as four rectangles that track the frame. */
function Shade({
  x,
  y,
  w,
  h,
  stage,
}: {
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  stage: { w: number; h: number };
}) {
  const top = useAnimatedStyle(() => ({ left: 0, right: 0, top: 0, height: Math.max(0, y.value) }));
  const bottom = useAnimatedStyle(() => ({
    left: 0,
    right: 0,
    top: y.value + h.value,
    height: Math.max(0, stage.h - (y.value + h.value)),
  }));
  const left = useAnimatedStyle(() => ({
    left: 0,
    top: y.value,
    width: Math.max(0, x.value),
    height: h.value,
  }));
  const right = useAnimatedStyle(() => ({
    left: x.value + w.value,
    top: y.value,
    width: Math.max(0, stage.w - (x.value + w.value)),
    height: h.value,
  }));

  return (
    <>
      <Animated.View pointerEvents="none" style={[styles.shade, top]} />
      <Animated.View pointerEvents="none" style={[styles.shade, bottom]} />
      <Animated.View pointerEvents="none" style={[styles.shade, left]} />
      <Animated.View pointerEvents="none" style={[styles.shade, right]} />
    </>
  );
}

function Grid() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.gridLine, { left: '33.33%', width: StyleSheet.hairlineWidth, height: '100%' }]} />
      <View style={[styles.gridLine, { left: '66.66%', width: StyleSheet.hairlineWidth, height: '100%' }]} />
      <View style={[styles.gridLine, { top: '33.33%', height: StyleSheet.hairlineWidth, width: '100%' }]} />
      <View style={[styles.gridLine, { top: '66.66%', height: StyleSheet.hairlineWidth, width: '100%' }]} />
    </View>
  );
}

/**
 * One draggable corner.
 *
 * Each corner moves two edges: the two it touches. The opposite corner is
 * therefore fixed, which is what makes a corner drag feel like resizing a
 * rectangle rather than dragging a point. With a ratio selected, the height
 * follows the width so the shape is preserved.
 */
function Corner({
  corner,
  x,
  y,
  w,
  h,
  bounds,
  ratio,
  color,
}: {
  corner: 'tl' | 'tr' | 'bl' | 'br';
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  bounds: Frame;
  ratio: number | null;
  color: string;
}) {
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);

  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';

  const gesture = Gesture.Pan()
    .onStart(() => {
      sx.value = x.value;
      sy.value = y.value;
      sw.value = w.value;
      sh.value = h.value;
      runOnJS(haptic)('select');
    })
    .onUpdate((e) => {
      const dx = left ? -e.translationX : e.translationX;
      // Room to grow before hitting the image edge on the side being dragged.
      const maxW = left ? sx.value + sw.value - bounds.x : bounds.x + bounds.w - sx.value;
      let nw = Math.min(maxW, Math.max(MIN_SIZE, sw.value + dx));

      let nh: number;
      if (ratio != null) {
        nh = nw / ratio;
        const maxH = top ? sy.value + sh.value - bounds.y : bounds.y + bounds.h - sy.value;
        if (nh > maxH) {
          nh = maxH;
          nw = nh * ratio;
        }
      } else {
        const dy = top ? -e.translationY : e.translationY;
        const maxH = top ? sy.value + sh.value - bounds.y : bounds.y + bounds.h - sy.value;
        nh = Math.min(maxH, Math.max(MIN_SIZE, sh.value + dy));
      }

      w.value = nw;
      h.value = nh;
      // A left/top drag moves the origin as well as the size; the opposite
      // corner has to stay exactly where it was.
      if (left) x.value = sx.value + sw.value - nw;
      if (top) y.value = sy.value + sh.value - nh;
    });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.handleHit,
          left ? { left: -HANDLE / 2 } : { right: -HANDLE / 2 },
          top ? { top: -HANDLE / 2 } : { bottom: -HANDLE / 2 },
        ]}
      >
        <View
          style={[
            styles.handle,
            { borderColor: color },
            left ? { borderLeftWidth: 3 } : { borderRightWidth: 3 },
            top ? { borderTopWidth: 3 } : { borderBottomWidth: 3 },
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#000000' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.base,
    paddingBottom: space.sm,
  },
  barBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  doneBtn: {
    minWidth: 74,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: { flex: 1, margin: space.base, alignItems: 'center', justifyContent: 'center' },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.62)' },
  frame: { position: 'absolute', borderWidth: 2 },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.45)' },
  handleHit: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: { width: 20, height: 20 },
  chip: {
    paddingHorizontal: space.md,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratios: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.base,
  },
  hint: { textAlign: 'center', paddingHorizontal: space.lg, paddingTop: space.sm },
});
