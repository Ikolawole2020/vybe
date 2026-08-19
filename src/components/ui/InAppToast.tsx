import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Avatar, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, shadow, space, spring } from '@/theme/tokens';

/**
 * In-app notifications, for things that arrive while you are looking.
 *
 * A push notification is for when the app is closed; the OS suppresses it — or
 * the user has never granted permission for it — when the app is in front. So a
 * direct message that landed while you were reading the feed produced nothing
 * at all: no sound, no banner, only a number on a tab you were not looking at.
 *
 * This is the banner for that case. It is deliberately a *notification*, not a
 * dialog: it announces, it can be tapped to go there, it can be flicked away,
 * and it leaves on its own if you ignore it.
 *
 * The API is a bare module-level listener rather than store state because a
 * toast is an event, not a fact about the world — putting it in the store means
 * deciding when to clear it, and every screen that reads the store re-renders
 * when one appears.
 */

export type Toast = {
  /** Used to route on tap. */
  href: string;
  title: string;
  body?: string;
  avatar?: string;
  /** Suppressed when this path is already on screen. */
  silentOn?: string;
};

type Listener = (t: Toast) => void;
let listener: Listener | null = null;

export function showToast(t: Toast) {
  listener?.(t);
}

const VISIBLE_MS = 4200;

export function InAppToastHost() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const [toast, setToast] = useState<Toast | null>(null);

  const y = useSharedValue(-160);

  const hide = useCallback(() => {
    y.value = withTiming(-160, { duration: 180 }, (done) => {
      if (done) runOnJS(setToast)(null);
    });
  }, [y]);

  useEffect(() => {
    listener = (t) => {
      // Announcing a message on the very screen that is already showing it is
      // noise, and it covers the thing it is announcing.
      if (t.silentOn && pathname?.startsWith(t.silentOn)) return;
      haptic('light');
      setToast(t);
    };
    return () => {
      listener = null;
    };
  }, [pathname]);

  useEffect(() => {
    if (!toast) return;
    y.value = withSpring(0, spring.gentle);
    const timer = setTimeout(hide, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [toast, y, hide]);

  const flick = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onUpdate((e) => {
      y.value = Math.min(0, e.translationY);
    })
    .onEnd(() => {
      if (y.value < -30) runOnJS(hide)();
      else y.value = withSpring(0, spring.snappy);
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: 1 + Math.min(0, y.value / 120),
  }));

  if (!toast) return null;

  const open = () => {
    haptic('light');
    hide();
    router.push(toast.href as any);
  };

  return (
    <GestureDetector gesture={flick}>
      <Animated.View
        style={[styles.wrap, { top: insets.top + space.sm }, style]}
        pointerEvents="box-none"
      >
        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel={`${toast.title}. ${toast.body ?? ''}. Tap to open.`}
          onTouchEnd={open}
          style={[
            styles.card,
            shadow.float,
            { backgroundColor: c.surfaceElevated, borderColor: c.border },
          ]}
        >
          <Avatar uri={toast.avatar} size={38} />
          <View style={{ flex: 1, gap: 2 }}>
            <VText variant="bodyMedium" numberOfLines={1}>
              {toast.title}
            </VText>
            {toast.body ? (
              <VText variant="caption" secondary numberOfLines={2}>
                {toast.body}
              </VText>
            ) : null}
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    zIndex: 100,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
