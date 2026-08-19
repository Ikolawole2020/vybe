import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { goBack } from '@/lib/goBack';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Avatar, Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, spring } from '@/theme/tokens';
import { fmtAge } from '@/algo/engine';
import { useAuthor, useVybe } from '@/store/useVybe';
import { fetchStoryViewCounts, fetchStoryViewers } from '@/services/db';
import type { Author, StoryItem } from '@/data/types';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STORY_DURATION = 5000; // 5 seconds per item

export default function StoryViewerModal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();

  const stories = useVybe((s) => s.stories);
  const markStorySeen = useVybe((s) => s.markStorySeen);
  const deleteStoryItem = useVybe((s) => s.deleteStoryItem);
  const hideStoryFromUser = useVybe((s) => s.hideStoryFromUser);
  const sendMessage = useVybe((s) => s.sendMessage);
  const startConversation = useVybe((s) => s.startConversation);
  const viewerId = useVybe((s) => s.profile.id);
  const authors = useVybe((s) => s.authors);

  /**
   * The stories you can actually walk through, in tray order.
   *
   * Navigation used to run over the raw `stories` array, which also holds
   * stories with no items left and stories every item of which is hidden from
   * this viewer. Tapping to the next one landed on those, and a story with
   * nothing in it renders the empty fallback — a black screen with an X. From
   * the outside that looks exactly like "tapping right does nothing", and the
   * only way on was to close and start again.
   *
   * This is the same filter the tray applies, so what you can reach by tapping
   * is what you could see to tap on in the first place.
   */
  const playable = stories.filter(
    (st) =>
      st.items.length > 0 &&
      !st.items.every((it) => it.hiddenUserIds?.includes(viewerId)),
  );

  const storyIndex = playable.findIndex((st) => st.authorId === id);
  const story = storyIndex >= 0 ? playable[storyIndex] : undefined;
  const author = useAuthor(story?.authorId ?? '');
  const isOwnStory = Boolean(viewerId) && story?.authorId === viewerId;

  const [itemIndex, setItemIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: number; emoji: string }[]>([]);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);

  /**
   * The audience for the item currently on screen.
   *
   * Fetched per item rather than once for the whole story, because the count is
   * shown against the frame being looked at — a story with three items has
   * three different audiences, and showing the total against each one would be
   * wrong for every frame but the first.
   *
   * Author-only: the read policy in `0010` returns nothing to anybody else, so
   * this is a no-op query on someone else's story rather than a leak.
   */
  const [viewersModalVisible, setViewersModalVisible] = useState(false);
  const [viewers, setViewers] = useState<{ author: Author; viewedAt: number }[]>([]);
  const [viewersLoading, setViewersLoading] = useState(false);
  const [viewCount, setViewCount] = useState(0);

  const progress = useSharedValue(0);
  const uiOpacity = useSharedValue(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pressStartTime = useRef<number>(0);

  /**
   * Clamped, because the index and the story it indexes into are set in two
   * different places — `setItemIndex` here, `setParams` in the router — and
   * nothing guarantees they land in the same commit. An index left pointing
   * past the end of a shorter story for even one frame renders the "no story"
   * fallback, which reads as the viewer having crashed.
   */
  const itemCount = story?.items.length ?? 0;
  const safeIndex = itemCount ? Math.min(itemIndex, itemCount - 1) : 0;
  const currentItem = story?.items[safeIndex];
  const seenRef = useRef<Set<string>>(new Set());

  const animatedUiStyle = useAnimatedStyle(() => ({
    opacity: uiOpacity.value,
  }));

  // Mark item as seen when loaded
  useEffect(() => {
    if (story?.authorId && currentItem?.id && !seenRef.current.has(currentItem.id)) {
      seenRef.current.add(currentItem.id);
      markStorySeen(story.authorId, currentItem.id);
    }
  }, [story?.authorId, currentItem?.id, markStorySeen]);

  /**
   * Keeps the eye count in step with the frame on screen.
   *
   * Only for your own story — `fetchStoryViewCounts` returns nothing for
   * anybody else's by policy, so calling it there would be a wasted round trip
   * per frame on every story anyone watches.
   */
  useEffect(() => {
    if (!isOwnStory || !currentItem?.id) {
      setViewCount(0);
      return;
    }
    let live = true;
    void fetchStoryViewCounts([currentItem.id]).then((counts) => {
      if (live) setViewCount(counts[currentItem.id] ?? 0);
    });
    return () => {
      live = false;
    };
  }, [isOwnStory, currentItem?.id]);

  // The list itself is only fetched when the sheet is opened. Loading every
  // viewer's profile to render a number nobody has asked to expand is the
  // difference between one small query per frame and one large one.
  useEffect(() => {
    if (!viewersModalVisible || !currentItem?.id) return;
    let live = true;
    setViewersLoading(true);
    void fetchStoryViewers(currentItem.id).then((list) => {
      if (!live) return;
      setViewers(list);
      setViewCount(list.length);
      setViewersLoading(false);
    });
    return () => {
      live = false;
    };
  }, [viewersModalVisible, currentItem?.id]);

  /**
   * Stories stop advancing when the app is not in front.
   *
   * The timer ran regardless, so backgrounding the app mid-story auto-advanced
   * through the rest of the tray in the user's pocket — and each frame was
   * marked seen on the way past. They came back to a row of grey rings and no
   * way to tell what they had missed, which is data loss dressed as a feature.
   */
  const [backgrounded, setBackgrounded] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setBackgrounded(s !== 'active'));
    return () => sub.remove();
  }, []);

  // Handle story progress timer
  useEffect(() => {
    progress.value = 0;
    if (paused || privacyModalVisible || backgrounded) return;

    const intervalTime = 50;
    const step = intervalTime / STORY_DURATION;

    timerRef.current = setInterval(() => {
      progress.value += step;
      if (progress.value >= 1) {
        progress.value = 1;
        if (timerRef.current) clearInterval(timerRef.current);
        handleNext();
      }
    }, intervalTime);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [safeIndex, paused, privacyModalVisible, backgrounded, story]);

  /**
   * Forward, the way Instagram and WhatsApp do it: through this person's
   * frames, then straight into the next person's, then out.
   *
   * Each step gives a tick of feedback — a selection tick inside a story, a
   * heavier one when you cross into somebody else's, so you can feel that the
   * name at the top has changed without having to look up at it.
   */
  const handleNext = () => {
    if (!story) {
      goBack();
      return;
    }
    if (safeIndex < story.items.length - 1) {
      haptic('select');
      setItemIndex(safeIndex + 1);
      return;
    }
    const next = playable[storyIndex + 1];
    if (next) {
      haptic('light');
      setItemIndex(0);
      router.setParams({ id: next.authorId });
    } else {
      goBack();
    }
  };

  const handlePrev = () => {
    if (safeIndex > 0) {
      haptic('select');
      setItemIndex(safeIndex - 1);
      return;
    }
    const prev = playable[storyIndex - 1];
    if (prev) {
      haptic('light');
      // Backwards into the *last* frame of the previous story, not its first.
      // Going back should undo a step, and dropping into frame one of a story
      // you already watched all of is not the step you just took.
      setItemIndex(Math.max(0, prev.items.length - 1));
      router.setParams({ id: prev.authorId });
    }
  };

  const handlePressIn = () => {
    pressStartTime.current = Date.now();
    uiOpacity.value = withTiming(0, { duration: 140 });
    setPaused(true);
  };

  const handlePressOut = () => {
    uiOpacity.value = withTiming(1, { duration: 140 });
    setPaused(false);
  };

  const handleLeftPress = () => {
    const duration = Date.now() - pressStartTime.current;
    if (duration > 220) return;
    handlePrev();
  };

  const handleRightPress = () => {
    const duration = Date.now() - pressStartTime.current;
    if (duration > 220) return;
    handleNext();
  };

  const handleDelete = () => {
    if (!currentItem) return;
    setPaused(true);
    Alert.alert(
      'Delete Status Update',
      'Are you sure you want to permanently delete this update?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => setPaused(false) },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            haptic('warning');
            deleteStoryItem(currentItem.id);
            if (!story || story.items.length <= 1) {
              goBack();
            } else {
              setItemIndex((i) => Math.max(0, i - 1));
              setPaused(false);
            }
          },
        },
      ]
    );
  };

  const handleReaction = (emoji: string) => {
    haptic('medium');
    const newId = Date.now();
    setFloatingEmojis((prev) => [...prev, { id: newId, emoji }]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((e) => e.id !== newId));
    }, 1800);

    // The reaction lands as a DM. `startConversation` resolves to the id the
    // server knows the thread by — it used to return a locally invented one and
    // swap it later, so a reaction sent to an existing thread was written into
    // a conversation that stopped existing a moment afterwards.
    if (story?.authorId) {
      void startConversation(story.authorId).then((convId) => {
        if (convId) sendMessage(convId, `Reacted ${emoji} to your story`);
      });
    }
  };

  /**
   * Swipe down to leave, the way every full-screen viewer works.
   *
   * The X in the corner is a target the size of a fingernail at the top of a
   * six-inch screen, and it was the only way out. A downward drag is what the
   * hand reaches for — the frame follows the finger, fades as it goes, and
   * either closes or springs back, so a half-committed swipe is recoverable
   * rather than an accident.
   *
   * `activeOffsetY([-9999, 12])` keeps it out of the way of everything else:
   * it only claims the gesture once you have pulled 12 points *downward*, so
   * taps still page through frames and upward drags do nothing.
   */
  const dragY = useSharedValue(0);
  const dismiss = Gesture.Pan()
    .activeOffsetY([-9999, 12])
    .onStart(() => {
      runOnJS(setPaused)(true);
    })
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
      runOnJS(setPaused)(false);
    });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: dragY.value },
      // A touch of scale as it goes, so it reads as the sheet lifting away
      // rather than the content sliding off the bottom of the screen.
      { scale: Math.max(0.88, 1 - dragY.value / 1400) },
    ],
    borderRadius: dragY.value > 0 ? radius.xxl : 0,
    opacity: Math.max(0.35, 1 - dragY.value / 700),
  }));

  const handleSendReply = () => {
    const text = replyText.trim();
    if (!text || !story?.authorId) return;
    haptic('success');
    // Cleared immediately: making the field wait on a round trip lets the user
    // press send twice and post the reply twice.
    setReplyText('');
    void startConversation(story.authorId).then((convId) => {
      if (convId) sendMessage(convId, text);
    });
  };

  if (!story || !story.items || story.items.length === 0 || !currentItem) {
    return (
      <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <Touchable onPress={() => goBack()} style={styles.closeBtn}>
          <Icon name="x" size={24} color="#FFFFFF" />
        </Touchable>
      </View>
    );
  }

  const networkAuthors = Object.values(authors).filter((a) => a.id !== viewerId);
  const hiddenCount = currentItem.hiddenUserIds?.length ?? 0;

  return (
    <GestureDetector gesture={dismiss}>
      <Animated.View style={[styles.container, styles.dismissable, dragStyle]}>
      {/* Background Story Ambient Backdrop */}
      <Image
        source={{ uri: currentItem.media }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={24}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />

      {/* Foreground Story Media (Preserves full image proportions without cropping) */}
      <Image
        source={{ uri: currentItem.media }}
        style={styles.mediaImage}
        contentFit="contain"
        transition={200}
      />

      {/* Interactive Touch Areas (Left = Prev, Right = Next, Hold = Full Screen Pure View) */}
      <View style={styles.touchArea}>
        <Pressable
          style={styles.touchLeft}
          onPress={handleLeftPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        />
        <Pressable
          style={styles.touchRight}
          onPress={handleRightPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        />
      </View>

      {/* Floating Emojis */}
      {floatingEmojis.map((e) => (
        <FloatingEmoji key={e.id} emoji={e.emoji} />
      ))}

      {/* Top Controls: Segmented Progress Bars & Header (Fades out when holding) */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.topSection, animatedUiStyle, { paddingTop: insets.top + space.sm }]}
      >
        {/* Scrims are decoration. Left touchable they sat at zIndex 10 over
            the tap zones, so the top 140pt and bottom 200pt of the screen
            swallowed every tap — which is most of where a thumb actually
            lands. */}
        <View pointerEvents="none" style={styles.overlayTop} />

        {/* Progress Bars */}
        <View style={styles.progressRow}>
          {story.items.map((it: StoryItem, idx: number) => {
            return (
              <ProgressBar
                key={it.id}
                isActive={idx === safeIndex}
                isPast={idx < safeIndex}
                activeProgress={progress}
              />
            );
          })}
        </View>

        {/* Author Header */}
        <View style={styles.authorRow}>
          <Touchable
            onPress={() => {
              goBack();
              router.push(`/profile-view/${story.authorId}`);
            }}
            feedback="light"
            style={styles.authorInfo}
          >
            <Avatar uri={author?.avatar ?? ''} size={36} />
            <View>
              <VText variant="bodyMedium" color="#FFFFFF">
                {isOwnStory ? 'Your Story' : author?.name ?? 'User'}
              </VText>
              <VText variant="micro" color="rgba(255, 255, 255, 0.7)">
                {fmtAge((Date.now() - currentItem.createdAt) / 3600_000)}
                {hiddenCount > 0 ? ` • ${hiddenCount} hidden` : ''}
              </VText>
            </View>
          </Touchable>

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {isOwnStory ? (
              <>
                <Touchable
                  onPress={() => {
                    setPaused(true);
                    router.push('/story/create' as any);
                  }}
                  feedback="light"
                  hitSlop={8}
                  style={[styles.topActionBtn, { backgroundColor: c.volt }]}
                  accessibilityLabel="Add to story"
                >
                  <Icon name="plus" size={17} color={c.onVolt} />
                </Touchable>
                <Touchable
                  onPress={() => {
                    setPaused(true);
                    setPrivacyModalVisible(true);
                  }}
                  feedback="light"
                  hitSlop={8}
                  style={styles.topActionBtn}
                  accessibilityLabel="Hide from users"
                >
                  <Icon
                    name={hiddenCount > 0 ? 'eye-off' : 'shield'}
                    size={17}
                    color={hiddenCount > 0 ? c.ember : '#FFFFFF'}
                  />
                </Touchable>
                <Touchable
                  onPress={handleDelete}
                  feedback="light"
                  hitSlop={8}
                  style={styles.topActionBtn}
                  accessibilityLabel="Delete story"
                >
                  <Icon name="trash-2" size={17} color="#FF453A" />
                </Touchable>
              </>
            ) : null}

            <Touchable
              onPress={() => goBack()}
              feedback="light"
              hitSlop={10}
              style={styles.closeBtn}
            >
              <Icon name="x" size={24} color="#FFFFFF" />
            </Touchable>
          </View>
        </View>
      </Animated.View>

      {/* Bottom Area: Caption & Composer (Fades out when holding) */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.bottomSection, animatedUiStyle]}
      >
        <View pointerEvents="none" style={styles.overlayBottom} />

        <KeyboardStickyView
          offset={{ closed: 0, opened: space.sm }}
          style={[styles.bottomWrap, { paddingBottom: Math.max(insets.bottom, 24) + space.lg }]}
        >
          {currentItem.caption ? (
            <View style={styles.captionBox}>
              <VText variant="body" color="#FFFFFF">
                {currentItem.caption}
              </VText>
            </View>
          ) : null}

          {isOwnStory ? (
            <View style={styles.ownStoryBottomBar}>
              {/*
                Who watched, in the place the status quo has trained everyone to
                look for it: bottom-left of your own story, an eye and a number.
                The count is the affordance — a bare eye gives no reason to tap,
                and "0" is genuinely useful information a minute after posting.
              */}
              <Touchable
                onPress={() => {
                  haptic('light');
                  setPaused(true);
                  setViewersModalVisible(true);
                }}
                feedback="light"
                style={styles.viewersPill}
                accessibilityLabel={`${viewCount} ${viewCount === 1 ? 'view' : 'views'}. Tap to see who.`}
              >
                <Icon name="eye" size={17} color="#FFFFFF" />
                <VText variant="bodyMedium" color="#FFFFFF" style={{ fontWeight: '700' }}>
                  {viewCount}
                </VText>
              </Touchable>

              <Touchable
                onPress={() => {
                  setPaused(true);
                  router.push('/story/create' as any);
                }}
                feedback="light"
                style={[styles.addStoryPill, { backgroundColor: c.volt }]}
                accessibilityLabel="Add to your story"
              >
                <Icon name="plus" size={18} color={c.onVolt} />
                <VText variant="bodyMedium" color={c.onVolt} style={{ fontWeight: '700' }}>
                  Add to Story
                </VText>
              </Touchable>
            </View>
          ) : (
            <>
              {/* Quick Reactions Bar */}
              <View style={styles.reactionBar}>
                {['🔥', '❤️', '⚡️', '👏', '😂'].map((emoji) => (
                  <Touchable
                    key={emoji}
                    onPress={() => handleReaction(emoji)}
                    feedback="select"
                    scaleTo={1.25}
                    style={styles.emojiBtn}
                  >
                    {/*
                      Plain `Text`, not `VText`. See `emojiText` — the clipping
                      came from inheriting Outfit's line metrics, and the most
                      reliable way not to inherit them is not to opt in. Nulling
                      `fontFamily` back out through a style override depends on
                      `StyleSheet.create` preserving an `undefined` value, which
                      is not something to rely on.
                    */}
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </Touchable>
                ))}
              </View>

              {/* Quick Reply Input */}
              <View style={styles.replyRow}>
                <TextInput
                  style={styles.replyInput}
                  placeholder={`Reply to ${author?.name ?? 'story'}...`}
                  placeholderTextColor="rgba(255, 255, 255, 0.6)"
                  value={replyText}
                  onChangeText={setReplyText}
                  onFocus={() => setPaused(true)}
                  onBlur={() => setPaused(false)}
                  returnKeyType="send"
                  onSubmitEditing={handleSendReply}
                />
                {replyText.length > 0 ? (
                  <Touchable
                    onPress={handleSendReply}
                    feedback="select"
                    style={[styles.sendBtn, { backgroundColor: c.volt }]}
                  >
                    <Icon name="send" size={18} color={c.onVolt} />
                  </Touchable>
                ) : null}
              </View>
            </>
          )}
        </KeyboardStickyView>
      </Animated.View>

      {/* Hide Story From Modal Sheet */}
      <Modal
        visible={privacyModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setPrivacyModalVisible(false);
          setPaused(false);
        }}
      >
        {/* Tapping the dim area closes the sheet — see FollowListModal. */}
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            setPrivacyModalVisible(false);
            setPaused(false);
          }}
        >
          <Pressable
            onPress={() => {}}
            accessible={false}
            style={[styles.modalSheet, { backgroundColor: c.surfaceElevated, paddingBottom: insets.bottom + space.lg }]}
          >
            <View style={styles.modalHeader}>
              <View>
                <VText variant="title">Hide Story From</VText>
                <VText variant="caption" secondary>
                  Select users who cannot view this story
                </VText>
              </View>
              <Touchable
                onPress={() => {
                  setPrivacyModalVisible(false);
                  setPaused(false);
                }}
                style={styles.modalCloseBtn}
              >
                <Icon name="x" size={20} color={c.text} />
              </Touchable>
            </View>

            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
              {networkAuthors.length > 0 ? (
                networkAuthors.map((a) => {
                  const isHidden = currentItem.hiddenUserIds?.includes(a.id) ?? false;
                  return (
                    <Touchable
                      key={a.id}
                      onPress={() => {
                        haptic('select');
                        hideStoryFromUser(currentItem.id, a.id);
                      }}
                      feedback="light"
                      style={[styles.userRow, { borderBottomColor: c.divider }]}
                    >
                      <Avatar uri={a.avatar} size={40} />
                      <View style={{ flex: 1 }}>
                        <VText variant="bodyMedium">{a.name}</VText>
                        <VText variant="caption" secondary>
                          @{a.handle}
                        </VText>
                      </View>
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: isHidden ? c.ember : c.border,
                            backgroundColor: isHidden ? c.ember : 'transparent',
                          },
                        ]}
                      >
                        {isHidden ? <Icon name="check" size={12} color="#FFFFFF" /> : null}
                      </View>
                    </Touchable>
                  );
                })
              ) : (
                <View style={{ padding: space.xl, alignItems: 'center' }}>
                  <VText variant="body" secondary>
                    No other users in your network yet.
                  </VText>
                </View>
              )}
            </ScrollView>

            <Button
              label="Done"
              onPress={() => {
                setPrivacyModalVisible(false);
                setPaused(false);
              }}
              style={{ marginTop: space.base }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/*
        Who watched this frame.

        Author-only by policy rather than by this component hiding it — the
        `story_views` read policy in `0010` returns nothing to anyone else, so
        there is no arrangement of client state that discloses an audience.
      */}
      <Modal
        visible={viewersModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setViewersModalVisible(false);
          setPaused(false);
        }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => {
            setViewersModalVisible(false);
            setPaused(false);
          }}
        >
          <Pressable
            onPress={() => {}}
            accessible={false}
            style={[
              styles.modalSheet,
              { backgroundColor: c.surfaceElevated, paddingBottom: insets.bottom + space.lg },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <VText variant="title">
                  {viewCount} {viewCount === 1 ? 'view' : 'views'}
                </VText>
                <VText variant="caption" secondary>
                  Only you can see this list
                </VText>
              </View>
              <Touchable
                onPress={() => {
                  setViewersModalVisible(false);
                  setPaused(false);
                }}
                style={styles.modalCloseBtn}
              >
                <Icon name="x" size={20} color={c.text} />
              </Touchable>
            </View>

            {viewersLoading ? (
              <View style={{ paddingVertical: 48, alignItems: 'center' }}>
                <ActivityIndicator color={c.volt} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {viewers.length > 0 ? (
                  viewers.map(({ author: v, viewedAt }) => (
                    <Touchable
                      key={v.id}
                      onPress={() => {
                        haptic('light');
                        setViewersModalVisible(false);
                        router.push(`/profile-view/${v.id}` as any);
                      }}
                      feedback="light"
                      style={styles.viewerRow}
                    >
                      <Avatar uri={v.avatar} size={42} />
                      <View style={{ flex: 1 }}>
                        <VText variant="bodyMedium" numberOfLines={1}>
                          {v.name}
                        </VText>
                        <VText variant="caption" secondary numberOfLines={1}>
                          @{v.handle}
                        </VText>
                      </View>
                      <VText variant="micro" muted>
                        {fmtAge((Date.now() - viewedAt) / 3600_000)}
                      </VText>
                    </Touchable>
                  ))
                ) : (
                  <View style={{ paddingVertical: 40, alignItems: 'center', gap: space.sm }}>
                    <Icon name="eye-off" size={30} color={c.textMuted} />
                    <VText variant="body" secondary>
                      Nobody has seen this yet
                    </VText>
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      </Animated.View>
    </GestureDetector>
  );
}

function ProgressBar({
  isActive,
  isPast,
  activeProgress,
}: {
  isActive: boolean;
  isPast: boolean;
  activeProgress: SharedValue<number>;
}) {
  const barStyle = useAnimatedStyle(() => {
    if (isPast) return { width: '100%' };
    if (isActive) return { width: `${Math.min(100, Math.max(0, activeProgress.value * 100))}%` };
    return { width: '0%' };
  });

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[styles.progressBarFill, barStyle]} />
    </View>
  );
}

function FloatingEmoji({ emoji }: { emoji: string }) {
  const y = useSharedValue(0);
  const opacity = useSharedValue(1);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withSpring(1.4, spring.snappy);
    y.value = withTiming(-240, { duration: 1500 });
    opacity.value = withSequence(withTiming(1, { duration: 1000 }), withTiming(0, { duration: 500 }));
  }, [opacity, scale, y]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.floatingEmoji, animStyle]}>
      {/* Plain `Text` for the same reason as the reaction bar — see `emojiText`. */}
      <Text style={styles.floatingEmojiText}>{emoji}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  // Rounds as it is dragged away, so the corner radius has something to clip.
  dismissable: { overflow: 'hidden' },
  mediaImage: {
    ...StyleSheet.absoluteFill,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  topSection: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.base,
    gap: space.md,
    zIndex: 10,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  overlayTop: {
    ...StyleSheet.absoluteFill,
    height: 140,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  overlayBottom: {
    ...StyleSheet.absoluteFill,
    height: 200,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
    height: 3,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 1.5,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  topActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    padding: 6,
  },
  touchArea: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    zIndex: 5,
  },
  touchLeft: {
    width: '30%',
    height: '100%',
  },
  touchRight: {
    width: '70%',
    height: '100%',
  },
  bottomWrap: {
    width: '100%',
    paddingHorizontal: space.base,
    gap: space.md,
  },
  captionBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    paddingHorizontal: space.base,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    alignSelf: 'flex-start',
    maxWidth: '92%',
  },
  ownStoryBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  viewersPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 48,
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
    // The same frosted disc the quick-reaction emojis use, so the two controls
    // on this bar read as the same family against an unknown photograph.
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  viewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
  },
  addStoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 48,
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  reactionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.base,
    paddingVertical: 4,
  },
  emojiBtn: {
    width: 46,
    height: 46,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Emoji need their own metrics, and inheriting the UI face's is what clipped
   * them.
   *
   * `VText` sets `fontFamily: Outfit`. Outfit has no emoji glyphs, so iOS and
   * Android substitute the system emoji font for the character — but the *line
   * box* is still built from Outfit's ascent and descent, which are tighter
   * than an emoji's. The glyph is drawn taller than the line it is given and
   * gets cut off top and bottom.
   *
   * Two things fix it:
   *   - Rendering through React Native's own `Text` rather than `VText`, so no
   *     `fontFamily` is applied and the line box comes from the system font —
   *     the one whose glyph is actually being drawn.
   *   - An explicit `lineHeight` about 1.35x the size. Emoji sit on a larger em
   *     box than Latin text and the default leading does not clear it.
   *
   * `includeFontPadding: false` is Android-only and stops the platform adding
   * asymmetric padding that pushes the glyph off-centre in a fixed-height disc.
   */
  emojiText: {
    fontSize: 22,
    lineHeight: 30,
    textAlign: 'center',
    includeFontPadding: false,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  replyInput: {
    flex: 1,
    height: 50,
    borderRadius: radius.pill,
    paddingHorizontal: space.base,
    color: '#FFFFFF',
    fontSize: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingEmoji: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    zIndex: 20,
  },
  floatingEmojiText: {
    fontSize: 42,
    lineHeight: 56,
    textAlign: 'center',
    includeFontPadding: false,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: space.base,
    gap: space.base,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: space.sm,
  },
  modalCloseBtn: {
    padding: 6,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
