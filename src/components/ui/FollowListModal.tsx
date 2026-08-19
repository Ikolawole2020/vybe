import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, Chip, Icon, Touchable, VText, } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { fetchUserFollowers, fetchUserFollowing } from '@/services/db';
import { useVybe } from '@/store/useVybe';
import type { Author } from '@/data/types';

export function FollowListModal({
  visible,
  userId,
  userName,
  initialTab = 'followers',
  onClose,
}: {
  visible: boolean;
  userId: string;
  userName: string;
  initialTab?: 'followers' | 'following';
  onClose: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(initialTab);
  const [followers, setFollowers] = useState<Author[]>([]);
  const [following, setFollowing] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);

  const viewerFollowing = useVybe((s) => s.following);
  const toggleFollow = useVybe((s) => s.toggleFollow);
  const circles = useVybe((s) => s.circles);
  const viewerId = useVybe((s) => s.profile.id);

  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
      setLoading(true);
      void Promise.all([
        fetchUserFollowers(userId),
        fetchUserFollowing(userId),
      ]).then(([flwers, flwing]) => {
        setFollowers(flwers);
        setFollowing(flwing);
        setLoading(false);
      });
    }
  }, [visible, userId, initialTab]);

  const list = activeTab === 'followers' ? followers : following;

  const handleOpenUser = (targetId: string) => {
    haptic('light');
    onClose();
    if (targetId === viewerId) {
      router.push('/(tabs)/profile' as any);
    } else {
      router.push(`/profile-view/${targetId}` as any);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      {/*
        Tapping the dimmed area closes the sheet.

        A bottom sheet's backdrop is the affordance everyone reaches for first,
        and with only an X button the dark area read as decoration rather than
        as a target. `Pressable` on the backdrop with a plain `View` for the
        sheet is what stops the dismissal firing on every tap inside the list —
        touches on the sheet do not reach the backdrop behind it.
      */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable
          // Swallows the press so a tap on the sheet is not a tap on the
          // backdrop. Not focusable, so it adds nothing for a screen reader.
          onPress={() => {}}
          accessible={false}
          style={[
            styles.sheet,
            {
              backgroundColor: c.surfaceElevated,
              paddingBottom: Math.max(insets.bottom, 24) + space.base,
            },
          ]}
        >
          {/* A grab handle, because a sheet that can be dismissed should look it. */}
          <View style={[styles.grabber, { backgroundColor: c.border }]} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <VText variant="title" numberOfLines={1}>
                {userName}
              </VText>
            </View>
            <Touchable onPress={onClose} feedback="light" style={styles.closeBtn} hitSlop={10}>
              <Icon name="x" size={22} color={c.text} />
            </Touchable>
          </View>

          {/* Segment Tabs */}
          <View style={styles.tabsRow}>
            <Chip
              label={`Followers (${followers.length})`}
              active={activeTab === 'followers'}
              onPress={() => {
                haptic('select');
                setActiveTab('followers');
              }}
            />
            <Chip
              label={`Following (${following.length})`}
              active={activeTab === 'following'}
              onPress={() => {
                haptic('select');
                setActiveTab('following');
              }}
            />
          </View>

          {/* List Content */}
          {loading ? (
            <View style={styles.loaderWrap}>
              <ActivityIndicator color={c.volt} size="large" />
            </View>
          ) : (
            <FlatList
              data={list}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 420 }}
              contentContainerStyle={{ paddingVertical: space.sm }}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: c.divider }]} />
              )}
              renderItem={({ item }) => {
                const isMe = item.id === viewerId;
                const isFollowing = viewerFollowing.includes(item.id);
                const memberCircle = circles.find((cc) => cc.memberIds.includes(item.id));

                return (
                  <View style={styles.userRow}>
                    <Touchable
                      onPress={() => handleOpenUser(item.id)}
                      feedback="light"
                      style={styles.userProfileTap}
                    >
                      <Avatar uri={item.avatar} size={44} ring={memberCircle?.color} />
                      <View style={{ flex: 1 }}>
                        <VText variant="bodyMedium" numberOfLines={1}>
                          {item.name}
                        </VText>
                        <VText variant="caption" secondary numberOfLines={1}>
                          @{item.handle}
                        </VText>
                      </View>
                    </Touchable>

                    {!isMe ? (
                      <Button
                        label={isFollowing ? 'Following' : 'Follow'}
                        variant={isFollowing ? 'ghost' : 'primary'}
                        glyph={isFollowing ? 'check' : 'plus'}
                        onPress={() => {
                          haptic(isFollowing ? 'light' : 'success');
                          toggleFollow(item.id);
                        }}
                        style={styles.followBtn}
                      />
                    ) : null}
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Icon name="users" size={36} color={c.textMuted} />
                  <VText variant="body" secondary style={{ marginTop: space.sm }}>
                    {activeTab === 'followers'
                      ? 'No followers yet'
                      : 'Not following anyone yet'}
                  </VText>
                </View>
              }
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 2,
  },
  sheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.base,
    paddingTop: space.base,
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  closeBtn: {
    padding: 6,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  loaderWrap: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
  },
  userProfileTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    flex: 1,
    paddingRight: space.sm,
  },
  followBtn: {
    minHeight: 38,
    paddingHorizontal: space.md,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 58,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
});
