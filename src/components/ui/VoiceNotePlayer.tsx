import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Icon, Touchable, VText, } from './index';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import type { VoiceNote } from '@/data/types';

export function VoiceNotePlayer({
  voiceNote,
  compact = false,
}: {
  voiceNote: VoiceNote;
  compact?: boolean;
}) {
  const { c } = useTheme();

  const isRemoteUrl = voiceNote.uri.startsWith('http://') || voiceNote.uri.startsWith('https://');
  const isLocalFile = voiceNote.uri.startsWith('file://') || voiceNote.uri.startsWith('/');
  const hasRealAudio = isRemoteUrl || isLocalFile;

  // expo-audio player
  const player = useAudioPlayer(
    hasRealAudio ? (isLocalFile && !voiceNote.uri.startsWith('file://') ? `file://${voiceNote.uri}` : voiceNote.uri) : null,
  );
  const status = useAudioPlayerStatus(player);

  const isPlaying = status.playing;
  const currentTime = status.currentTime ?? 0;
  const totalDuration = status.duration && status.duration > 0 ? status.duration : voiceNote.durationSeconds;

  // Fallback for fake/no-audio voice notes (visual-only playback)
  const [fakeProgress, setFakeProgress] = useState(0);
  const [fakePlaying, setFakePlaying] = useState(false);
  const fakeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const durationSec = Math.max(1, voiceNote.durationSeconds || 5);

  useEffect(() => {
    if (!hasRealAudio && fakePlaying) {
      fakeTimerRef.current = setInterval(() => {
        setFakeProgress((prev) => {
          if (prev >= durationSec) {
            setFakePlaying(false);
            return 0;
          }
          return Math.min(durationSec, prev + 0.15);
        });
      }, 150);
    } else {
      if (fakeTimerRef.current) {
        clearInterval(fakeTimerRef.current);
        fakeTimerRef.current = null;
      }
    }
    return () => {
      if (fakeTimerRef.current) clearInterval(fakeTimerRef.current);
    };
  }, [fakePlaying, hasRealAudio, durationSec]);

  const togglePlay = useCallback(() => {
    haptic('light');
    if (hasRealAudio) {
      if (isPlaying) {
        player.pause();
      } else {
        if (currentTime >= totalDuration - 0.5) {
          player.seekTo(0);
        }
        player.play();
      }
    } else {
      // Fake playback for placeholder URIs
      if (fakePlaying) {
        setFakePlaying(false);
      } else {
        if (fakeProgress >= durationSec) setFakeProgress(0);
        setFakePlaying(true);
      }
    }
  }, [hasRealAudio, isPlaying, currentTime, totalDuration, player, fakePlaying, fakeProgress, durationSec]);

  const playing = hasRealAudio ? isPlaying : fakePlaying;
  const progress = hasRealAudio ? currentTime : fakeProgress;
  const duration = hasRealAudio ? totalDuration : durationSec;

  const waveformHeights = voiceNote.waveform && voiceNote.waveform.length > 0
    ? voiceNote.waveform
    : [40, 75, 90, 60, 45, 80, 100, 85, 55, 70, 95, 60, 40, 80, 70, 50, 85, 65, 45, 30];

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: c.surfaceElevated,
          borderColor: c.border,
          paddingVertical: compact ? space.sm : space.md,
        },
      ]}
    >
      <Touchable
        onPress={togglePlay}
        feedback="select"
        scaleTo={0.9}
        accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
        style={[styles.playBtn, { backgroundColor: c.volt }]}
      >
        <Icon name={playing ? 'pause' : 'play'} size={compact ? 14 : 16} color={c.onVolt} />
      </Touchable>

      <View style={styles.waveWrap}>
        <View style={styles.barsRow}>
          {waveformHeights.map((h, i) => {
            const playedRatio = duration > 0 ? progress / duration : 0;
            const barRatio = i / waveformHeights.length;
            const isBarPlayed = barRatio <= playedRatio;

            return (
              <View
                key={i}
                style={[
                  styles.bar,
                  {
                    height: (h / 100) * (compact ? 18 : 26),
                    backgroundColor: isBarPlayed ? c.volt : c.textMuted,
                    opacity: isBarPlayed ? 1 : 0.35,
                  },
                ]}
              />
            );
          })}
        </View>

        <View style={styles.timeRow}>
          <VText variant="micro" muted>
            {formatTime(playing ? progress : duration)}
          </VText>
          <VText variant="micro" color={c.volt}>
            Voice Memo
          </VText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.base,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveWrap: {
    flex: 1,
    gap: 4,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 26,
  },
  bar: {
    width: 3,
    borderRadius: 1.5,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
