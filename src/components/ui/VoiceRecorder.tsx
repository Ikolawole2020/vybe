import React, { useEffect, useRef, useState } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from 'expo-audio';
import { Icon, Touchable, VText, } from './index';
import { haptic } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import type { VoiceNote } from '@/data/types';

export type VoiceRecorderProps = {
  onSendVoiceNote: (voiceNote: VoiceNote) => void;
  disabled?: boolean;
  /**
   * Fires whenever recording starts or stops, so the chat can tell the other
   * person. Driven off the `isRecording` state rather than from the three
   * call sites that change it — start, cancel, and finish — because a fourth
   * (the auto-send at `MAX_SECONDS`) already exists and would have been missed.
   */
  onRecordingChange?: (isRecording: boolean) => void;
};

/** Hard ceiling on one voice note. Five minutes of m4a is roughly 2.5 MB. */
const MAX_SECONDS = 300;

function LiveWaveBar({ index }: { index: number }) {
  const { c } = useTheme();
  const height = useSharedValue(6 + (index % 3) * 6);

  useEffect(() => {
    height.value = withRepeat(
      withSequence(
        withTiming(8 + Math.random() * 16, { duration: 180 + (index % 4) * 60 }),
        withTiming(4 + Math.random() * 8, { duration: 180 + (index % 4) * 60 }),
      ),
      -1,
      true,
    );
  }, [index, height]);

  const barStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return (
    <Animated.View
      style={[
        styles.waveBar,
        { backgroundColor: c.volt },
        barStyle,
      ]}
    />
  );
}

export function VoiceRecorder({
  onSendVoiceNote,
  disabled = false,
  onRecordingChange,
}: VoiceRecorderProps) {
  const { c } = useTheme();

  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  /** Guards the send against a double tap, which would stop an already-stopped recorder. */
  const sendingRef = useRef(false);
  const finishRef = useRef<() => void>(() => {});

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const pulseScale = useSharedValue(1);

  /**
   * Held in a ref so the announcing effect below does not have to list the
   * callback as a dependency. A parent that passes an inline arrow — which is
   * every parent — would otherwise re-run it on every render and re-announce a
   * recording that never changed.
   */
  const recordingChangeRef = useRef(onRecordingChange);
  recordingChangeRef.current = onRecordingChange;

  useEffect(() => {
    recordingChangeRef.current?.(isRecording);
    // On unmount, say so. Navigating away mid-recording otherwise leaves the
    // other person watching a recording indicator for something that will never
    // arrive, with nothing left on this side to ever clear it.
    return () => {
      if (isRecording) recordingChangeRef.current?.(false);
    };
  }, [isRecording]);

  /**
   * Reads the current permission — it does not ask for it.
   *
   * This used to call `requestRecordingPermissionsAsync` on mount, so simply
   * opening a chat threw up the microphone dialog before the user had shown any
   * interest in recording anything. A permission prompt with no context is the
   * one users deny. It is requested on the first tap of the mic instead, where
   * the reason for it is on screen.
   */
  useEffect(() => {
    let live = true;
    void AudioModule.getRecordingPermissionsAsync().then((perm) => {
      if (live) setPermissionGranted(perm.granted);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (isRecording) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.3, { duration: 400 }),
          withTiming(1, { duration: 400 }),
        ),
        -1,
        true,
      );
      setSeconds(0);
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          // Nothing bounded this. A recorder left running produced a file that
          // grew until the disk did not have room for it, and the bucket would
          // refuse the upload at the far end anyway. Auto-sending at the cap is
          // gentler than discarding what was said.
          if (s + 1 >= MAX_SECONDS) finishRef.current();
          return s + 1;
        });
      }, 1000);
    } else {
      pulseScale.value = withTiming(1, { duration: 150 });
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording, pulseScale]);

  const generateWaveform = (duration: number): number[] => {
    const barsCount = Math.min(24, Math.max(12, Math.floor(duration * 2)));
    return Array.from({ length: barsCount }, () =>
      Math.floor(25 + Math.random() * 75),
    );
  };

  const handleStart = async () => {
    if (disabled) return;

    if (!permissionGranted) {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Microphone Access Required',
          'Please enable microphone access in Settings to record voice notes.',
        );
        return;
      }
      setPermissionGranted(true);
    }

    try {
      haptic('medium');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
    } catch (err) {
      console.warn('Failed to start recording:', err);
      Alert.alert('Error', 'Could not start recording: ' + String(err));
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }
  };

  const handleCancel = () => {
    haptic('warning');
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    void (async () => {
      try {
        await audioRecorder.stop();
      } catch {
        // Already stopped, or never started. Nothing to recover.
      }
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    })();
  };

  const handleFinishAndSend = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;

    const elapsed = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    haptic('success');
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      // `stop()` returns a promise and it was not awaited. The file is only
      // finalised when it resolves, so `audioRecorder.uri` was read while the
      // recorder was still closing — sometimes null, sometimes a zero-byte
      // file. The 200ms sleep that stood in for awaiting it worked on a fast
      // device and did not on a slow one, which is why this failed
      // intermittently rather than always.
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

      const uri = audioRecorder.uri;
      if (!uri) throw new Error('The recorder produced no file.');

      onSendVoiceNote({ uri, durationSeconds: elapsed, waveform: generateWaveform(elapsed) });
    } catch (err) {
      console.warn('[VoiceRecorder] Could not finish the recording', err);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      // The old fallback here sent `voice_memo_<timestamp>.m4a` — a filename
      // that is not a path to anything. It uploaded nothing, and the recipient
      // got a bubble with a play button that could never play. Saying the
      // recording failed is the only honest option.
      Alert.alert('Recording failed', 'That voice note could not be saved. Please try again.');
    } finally {
      sendingRef.current = false;
    }
  };

  // The auto-stop timer needs to call the latest closure without becoming a
  // dependency of the interval that owns it.
  finishRef.current = () => void handleFinishAndSend();

  /**
   * A recording left running when the screen goes away.
   *
   * Navigating back mid-record used to leave the native recorder holding the
   * microphone and the audio session in recording mode — on iOS that silences
   * every other sound in the app until it is reset, and on Android it holds the
   * mic against every other app on the phone.
   */
  useEffect(
    () => () => {
      void audioRecorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    },
    [audioRecorder],
  );

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  // Full-width Active Recording Bar
  if (isRecording) {
    return (
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(150)}
        style={[
          styles.activeBar,
          {
            backgroundColor: c.surfaceElevated,
            borderColor: c.volt,
          },
        ]}
      >
        {/* Left: Cancel Trash Button */}
        <Touchable
          onPress={handleCancel}
          feedback="medium"
          hitSlop={12}
          style={[styles.actionBtn, { backgroundColor: c.surface }]}
          accessibilityLabel="Cancel recording"
        >
          <Icon name="trash-2" size={18} color="#FF453A" />
        </Touchable>

        {/* Center: Live indicator, timer, and animated waveform */}
        <View style={styles.centerSection}>
          <View style={styles.recordIndicator}>
            <Animated.View style={[styles.redDot, pulseStyle]} />
            <VText
              variant="bodyMedium"
              color={c.ember}
              style={styles.timerText}
            >
              {formatTime(seconds)}
            </VText>
          </View>

          <View style={styles.waveContainer}>
            {Array.from({ length: 14 }, (_, i) => (
              <LiveWaveBar key={i} index={i} />
            ))}
          </View>
        </View>

        {/* Right: Send Voice Note Button */}
        <Touchable
          onPress={handleFinishAndSend}
          feedback="success"
          hitSlop={12}
          style={[styles.actionBtn, styles.sendBtn, { backgroundColor: c.volt }]}
          accessibilityLabel="Send voice note"
        >
          <Icon name="send" size={17} color={c.onVolt} />
        </Touchable>
      </Animated.View>
    );
  }

  // Idle Mic Button
  return (
    <Touchable
      onPress={handleStart}
      disabled={disabled}
      feedback="medium"
      scaleTo={0.92}
      hitSlop={8}
      style={[
        styles.idleMicBtn,
        {
          backgroundColor: c.surfaceElevated,
          borderColor: c.border,
        },
      ]}
      accessibilityLabel="Record voice message"
    >
      <Icon name="mic" size={18} color={c.text} />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  idleMicBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  activeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.base,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    zIndex: 100,
  },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  centerSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
  },
  recordIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  redDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#FF453A',
  },
  timerText: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 14,
  },
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
  },
  waveBar: {
    width: 2.5,
    borderRadius: 1.5,
  },
});
