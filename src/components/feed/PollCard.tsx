import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Icon, Touchable, VText, haptic } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import type { Poll, PollOption } from '@/data/types';

export function PollCard({
  poll,
  onVote,
}: {
  poll: Poll;
  onVote: (optionId: string) => void;
}) {
  const { c } = useTheme();
  const hasVoted = !!poll.userVotedOptionId;
  const totalVotes = Math.max(poll.totalVotes, 1);

  return (
    <View style={[styles.card, { backgroundColor: c.surfaceElevated, borderColor: c.border }]}>
      {poll.question ? (
        <VText variant="bodyMedium" style={styles.question}>
          {poll.question}
        </VText>
      ) : null}

      <View style={{ gap: space.sm }}>
        {poll.options.map((option) => {
          const isSelected = poll.userVotedOptionId === option.id;
          const pct = Math.round((option.votes / totalVotes) * 100);

          return (
            <PollOptionRow
              key={option.id}
              option={option}
              percent={pct}
              hasVoted={hasVoted}
              isSelected={isSelected}
              onPress={() => {
                haptic('select');
                onVote(option.id);
              }}
            />
          );
        })}
      </View>

      <View style={styles.footer}>
        <VText variant="micro" muted>
          {poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'} · {hasVoted ? 'Final results' : 'Tap to vote'}
        </VText>
      </View>
    </View>
  );
}

function PollOptionRow({
  option,
  percent,
  hasVoted,
  isSelected,
  onPress,
}: {
  option: PollOption;
  percent: number;
  hasVoted: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const { c } = useTheme();

  const barStyle = useAnimatedStyle(() => ({
    width: withTiming(`${hasVoted ? percent : 0}%`, { duration: 400 }),
  }));

  return (
    <Touchable
      onPress={onPress}
      disabled={hasVoted}
      feedback="light"
      scaleTo={0.98}
      accessibilityLabel={`${option.text}, ${percent}% of votes`}
      style={[
        styles.option,
        {
          borderColor: isSelected ? c.volt : c.border,
          backgroundColor: c.bgSubtle,
        },
      ]}
    >
      {hasVoted ? (
        <Animated.View
          style={[
            styles.fillBar,
            { backgroundColor: isSelected ? 'rgba(216, 255, 0, 0.22)' : 'rgba(255, 255, 255, 0.08)' },
            barStyle,
          ]}
        />
      ) : null}

      <View style={styles.optionContent}>
        <View style={styles.optionTextRow}>
          {isSelected ? (
            <Icon name="check-circle" size={16} color={c.volt} style={{ marginRight: 2 }} />
          ) : null}
          <VText variant="body" color={isSelected ? c.volt : c.text} numberOfLines={1}>
            {option.text}
          </VText>
        </View>

        {hasVoted ? (
          <VText variant="label" color={isSelected ? c.volt : c.textSecondary}>
            {percent}%
          </VText>
        ) : null}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: space.base,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space.md,
  },
  question: { marginBottom: 2 },
  option: {
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: space.base,
  },
  fillBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  optionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  optionTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    paddingRight: space.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
