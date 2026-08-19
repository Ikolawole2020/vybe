import React from 'react';
import { ScrollView, StyleSheet, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, {
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import type { FeedMode } from '@/data/types';
import { useVybe } from '@/store/useVybe';

const MODES: { id: FeedMode; label: string }[] = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'circles', label: 'Circles' },
  { id: 'latest', label: 'Latest' },
];

export function FeedHeader({ scrollY }: { scrollY: SharedValue<number> }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mode = useVybe((s) => s.feedMode);
  const setMode = useVybe((s) => s.setFeedMode);
  const profile = useVybe((s) => s.profile);
  const unreadNotifs = useVybe((s) => s.unreadNotificationsCount);
  const unreadDMs = useVybe((s) => s.conversations.reduce((sum, conv) => sum + conv.unreadCount, 0));

  const mastheadStyle = useAnimatedStyle(() => ({
    height: interpolate(scrollY.value, [0, 64], [48, 0], 'clamp'),
    opacity: interpolate(scrollY.value, [0, 44], [1, 0], 'clamp'),
  }));

  return (
    <View
      style={[styles.wrap, { paddingTop: insets.top + 6, backgroundColor: c.bg }]}
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.masthead, mastheadStyle]}>
        {/* Top Left: User Profile Avatar */}
        <Touchable
          onPress={() => router.push('/profile' as any)}
          scaleTo={0.92}
          accessibilityLabel="User Profile"
          style={[styles.avatarButton, { backgroundColor: c.surfaceElevated }]}
        >
          {profile.avatar ? (
            <Image source={{ uri: profile.avatar }} style={styles.avatarImage} />
          ) : (
            <Icon name="user" size={18} color={c.textSecondary} />
          )}
        </Touchable>

        <View style={styles.actions}>
          <HeaderButton
            glyph="bell"
            label="Notifications"
            badge={unreadNotifs || undefined}
            onPress={() => router.push('/notifications' as any)}
          />
          <HeaderButton
            glyph="message-circle"
            label="Messages"
            badge={unreadDMs || undefined}
            onPress={() => router.push('/messages' as any)}
          />
        </View>
      </Animated.View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {MODES.map((m) => {
          const on = m.id === mode;
          return (
            <Touchable
              key={m.id}
              onPress={() => {
                haptic('select');
                setMode(m.id);
              }}
              feedback="none"
              scaleTo={0.95}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${m.label} feed`}
              style={[
                styles.chip,
                { backgroundColor: on ? c.volt : c.surfaceElevated },
              ]}
            >
              <VText variant="label" color={on ? c.onVolt : c.textSecondary}>
                {m.label}
              </VText>
            </Touchable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function HeaderButton({
  glyph,
  label,
  onPress,
  badge,
}: {
  glyph: React.ComponentProps<typeof Icon>['name'];
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  const { c } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      hitSlop={10}
      scaleTo={0.92}
      accessibilityLabel={label}
      style={[styles.headerBtn, { backgroundColor: c.surfaceElevated }]}
    >
      <Icon name={glyph} size={17} color={c.textSecondary} />
      {badge ? (
        <View style={[styles.badge, { backgroundColor: c.volt, borderColor: c.bg }]}>
          <VText variant="micro" color={c.onVolt} style={{ fontSize: 9, letterSpacing: 0 }}>
            {badge}
          </VText>
        </View>
      ) : null}
    </Touchable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 20,
  },
  masthead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.gutter,
    overflow: 'hidden',
  },
  avatarButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  strip: { paddingHorizontal: space.gutter, gap: space.sm, paddingVertical: space.md },
  chip: {
    height: 38,
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});