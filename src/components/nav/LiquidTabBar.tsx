import React, { useEffect, useState } from 'react';
import { DeviceEventEmitter, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Glass, LIQUID_GLASS } from '@/components/glass/Glass';
import { Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { duration, radius, shadow, space, spring } from '@/theme/tokens';

const BAR_HEIGHT = 64;
const H_MARGIN = 14;
const COMPOSE = 44;

type TabMeta = { name: string; glyph: React.ComponentProps<typeof Icon>['name']; label: string };

const TABS: TabMeta[] = [
  { name: 'index', glyph: 'home', label: 'Feed' },
  { name: 'discover', glyph: 'search', label: 'Discover' },
  { name: 'algo', glyph: 'sliders', label: 'Your Algo' },
  { name: 'profile', glyph: 'user', label: 'You' },
];

type Slot = { x: number; width: number };

type TabBarProps = {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => {
      defaultPrevented: boolean;
    };
    navigate: (name: string) => void;
  };
};

export function LiquidTabBar({ state, navigation }: TabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const activeIndex = TABS.findIndex((t) => t.name === state.routes[state.index]?.name);
  const [slots, setSlots] = useState<Record<string, Slot>>({});

  const active = activeIndex >= 0 ? slots[TABS[activeIndex].name] : undefined;
  const x = useSharedValue(0);
  const w = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    x.value = withSpring(active.x, spring.snappy);
    w.value = withSpring(active.width, spring.snappy);
  }, [active, x, w]);

  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: w.value,
    opacity: active ? 1 : 0,
    backgroundColor: c.volt,
  }));

  const measure = (name: string) => (e: any) => {
    const { x: lx, width } = e.nativeEvent.layout;
    setSlots((prev) =>
      prev[name]?.x === lx && prev[name]?.width === width
        ? prev
        : { ...prev, [name]: { x: lx, width } },
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: H_MARGIN },
      ]}
    >
      <Glass
        variant="regular"
        interactive
        radius={radius.pill}
        style={[
          styles.bar,
          shadow.float,
          !LIQUID_GLASS && { backgroundColor: c.glassTint, borderColor: c.glassBorder },
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.indicator, indicator]} />

        {TABS.map((tab, i) => {
          const focused = i === activeIndex;
          const slot = (
            <TabButton
              key={tab.name}
              tab={tab}
              focused={focused}
              onLayout={measure(tab.name)}
              onPress={() => {
                const route = state.routes.find((r: { name: string }) => r.name === tab.name);
                if (!route) return;

                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });

                if (focused) {
                  // If already on Feed, trigger scroll-to-top and refresh
                  if (tab.name === 'index') {
                    DeviceEventEmitter.emit('scrollToTopFeed');
                  }
                } else if (!event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
            />
          );

          if (i !== 2) return slot;
          return (
            <React.Fragment key={tab.name}>
              <Touchable
                onPress={() => router.push('/compose')}
                feedback="medium"
                scaleTo={0.9}
                accessibilityLabel="Create a post"
                style={[styles.compose, { borderColor: c.borderStrong }]}
              >
                <Icon name="plus" size={22} color={c.text} />
              </Touchable>
              {slot}
            </React.Fragment>
          );
        })}
      </Glass>
    </View>
  );
}

function TabButton({
  tab,
  focused,
  onPress,
  onLayout,
}: {
  tab: TabMeta;
  focused: boolean;
  onPress: () => void;
  onLayout: (e: any) => void;
}) {
  const { c } = useTheme();
  const open = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    open.value = withTiming(focused ? 1 : 0, { duration: duration.base });
  }, [focused, open]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: open.value,
    maxWidth: open.value * 90,
    marginLeft: open.value * 7,
  }));

  return (
    <Touchable
      onPress={() => {
        haptic('select');
        onPress();
      }}
      feedback="none"
      scaleTo={0.94}
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={tab.label}
      style={styles.tab}
    >
      <Icon name={tab.glyph} size={21} color={focused ? c.onVolt : c.textSecondary} />
      <Animated.View style={[styles.labelClip, labelStyle]}>
        <VText variant="label" color={c.onVolt} numberOfLines={1}>
          {tab.label}
        </VText>
      </Animated.View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: BAR_HEIGHT - 14,
    paddingHorizontal: 16,
  },
  labelClip: { overflow: 'hidden' },
  indicator: {
    position: 'absolute',
    left: 0,
    top: 7,
    height: BAR_HEIGHT - 14,
    borderRadius: radius.pill,
  },
  compose: {
    width: COMPOSE,
    height: COMPOSE,
    borderRadius: COMPOSE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export const TAB_BAR_CLEARANCE = BAR_HEIGHT + space.lg;