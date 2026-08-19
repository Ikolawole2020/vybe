import React from 'react';
import { Dimensions, Modal, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { spring } from '@/theme/tokens';

const { width: W, height: H } = Dimensions.get('window');

/**
 * Hold-to-peek, the way iOS does it.
 *
 * A long press on any photo in the feed lifts it out of the row and holds it
 * full-screen for as long as the finger is down; lifting the finger drops it
 * back. It is deliberately *not* a navigation: nothing is pushed, nothing has
 * to be dismissed, and the reader's place in the feed is never lost. Tap still
 * opens the photo screen for anyone who wants to stay in it.
 *
 * The image is `contain`-fitted against a blurred ground, so a peek always
 * shows the whole frame — which is the point of peeking at it.
 */
export function MediaPeek({ uri, aspect }: { uri: string | null; aspect?: number }) {
  const scale = useSharedValue(0.88);

  React.useEffect(() => {
    if (uri) {
      scale.value = 0.88;
      scale.value = withSpring(1, spring.gentle);
    }
  }, [uri, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (!uri) return null;

  // Fill the shorter dimension, never overflow the other — the same maths
  // `contain` does, done here so the blur ground reads as a frame around the
  // photo rather than behind a full-bleed one.
  const r = aspect && aspect > 0 ? aspect : 1;
  const maxW = W * 0.92;
  const maxH = H * 0.78;
  const width = Math.min(maxW, maxH * r);
  const height = width / r;

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible onRequestClose={() => {}}>
      <Animated.View
        entering={FadeIn.duration(140)}
        exiting={FadeOut.duration(120)}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill}>
          <View style={styles.center}>
            <Animated.View style={[{ width, height }, styles.plate, style]}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
            </Animated.View>
          </View>
        </BlurView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' },
  plate: {
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
    elevation: 24,
  },
});
