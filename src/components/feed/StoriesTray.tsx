import React from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { useAuthor, useVybe } from '@/store/useVybe';
import type { Story } from '@/data/types';

export function StoriesTray() {
  const { c } = useTheme();
  const router = useRouter();
  const stories = useVybe((s) => s.stories);
  const myProfile = useVybe((s) => s.profile);

  // The `|| authorId === 'me'` arms that used to be here matched a placeholder
  // id an earlier version of `addStory` invented when it could not resolve the
  // signed-in user. Nothing writes it any more, and leaving the check in meant
  // a second account on the same handset could inherit the first one's bubble.
  const myStory = myProfile.id ? stories.find((st) => st.authorId === myProfile.id) : undefined;
  const hasMyStory = Boolean(myStory && myStory.items.length > 0);

  const openMyStory = () => {
    haptic('light');
    if (hasMyStory && myStory) {
      Alert.alert(
        'Your Story',
        'Choose an action:',
        [
          {
            text: 'Add to Story',
            onPress: () => {
              haptic('light');
              router.push('/story/create' as any);
            },
          },
          {
            text: 'View Story',
            onPress: () => {
              haptic('light');
              router.push(`/story/${myStory.authorId}` as any);
            },
          },
          {
            text: 'Cancel',
            style: 'cancel',
          },
        ]
      );
    } else {
      router.push('/story/create' as any);
    }
  };

  /**
   * Other people's bubbles.
   *
   * The hide check stays as a belt to the server's braces — the `story_items`
   * read policy will not return an item the viewer is excluded from, so this
   * can only ever filter something already filtered. It is worth keeping
   * because it is also correct for the offline case, where the store may still
   * hold an item fetched before the author hid it.
   */
  const visibleStories = stories.filter(
    (st) =>
      st.authorId !== myProfile.id &&
      st.items.length > 0 &&
      !st.items.every((it) => it.hiddenUserIds?.includes(myProfile.id)),
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/*
          Your bubble.

          The `+` badge used to be a Touchable *inside* the bubble's Touchable.
          Android's touch system does not reliably pick a winner between nested
          pressables that overlap — the badge tap frequently fired the parent as
          well, so tapping `+` opened the "Add to Story / View Story" dialog on
          top of the creator it had just pushed. They are siblings now, with the
          badge positioned over the avatar rather than nested in it.
        */}
        <View style={styles.storyItem}>
          <View style={styles.avatarWrap}>
            <Touchable
              onPress={openMyStory}
              feedback="light"
              scaleTo={0.93}
              accessibilityLabel="Your story"
              style={
                hasMyStory
                  ? { borderRadius: 34, padding: 2, borderWidth: 2, borderColor: c.volt }
                  : { borderRadius: 34, padding: 2 }
              }
            >
              <Avatar uri={myProfile.avatar} size={54} />
            </Touchable>

            <Touchable
              onPress={() => {
                haptic('light');
                router.push('/story/create' as any);
              }}
              feedback="select"
              hitSlop={10}
              accessibilityLabel="Add to your story"
              style={[styles.plusBadge, { backgroundColor: c.volt, borderColor: c.bg }]}
            >
              <Icon name="plus" size={15} color={c.onVolt} />
            </Touchable>
          </View>
          <VText variant="micro" numberOfLines={1} style={styles.name}>
            Your story
          </VText>
        </View>

        {/* Network Stories (distinct users only) */}
        {visibleStories.map((story) => (
          <StoryBubble key={story.id} story={story} />
        ))}
      </ScrollView>
    </View>
  );
}

function StoryBubble({ story }: { story: Story }) {
  const { c } = useTheme();
  const router = useRouter();
  const author = useAuthor(story.authorId);
  const seenStoryItemIds = useVybe((s) => s.seenStoryItemIds);

  const hasUnseen =
    story.hasUnseen &&
    story.items.some((it) => !it.seen && !seenStoryItemIds.includes(it.id));

  const handlePress = () => {
    haptic('light');
    router.push(`/story/${story.authorId}` as any);
  };

  return (
    <Touchable
      onPress={handlePress}
      feedback="light"
      scaleTo={0.93}
      accessibilityLabel={`View story from ${author?.name}`}
      style={styles.storyItem}
    >
      <View
        style={[
          styles.ring,
          {
            borderColor: hasUnseen ? c.volt : c.border,
            borderWidth: hasUnseen ? 2 : 1,
            opacity: hasUnseen ? 1 : 0.6,
          },
        ]}
      >
        <Avatar uri={author?.avatar ?? ''} size={52} />
      </View>
      <VText
        variant="micro"
        numberOfLines={1}
        style={[styles.name, !hasUnseen && { color: c.textMuted }]}
      >
        {author?.name ?? 'User'}
      </VText>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: space.sm,
  },
  scrollContent: {
    paddingHorizontal: space.gutter,
    gap: space.md,
    alignItems: 'center',
  },
  storyItem: {
    alignItems: 'center',
    gap: 5,
    width: 68,
  },
  avatarWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1.5 },
  },
  ring: {
    padding: 3,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 11,
    textAlign: 'center',
  },
});
