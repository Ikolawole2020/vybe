import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, Touchable, VText, haptic } from '@/components/ui';
import { Notice } from '@/components/ui/Field';
import { CodeInput } from '@/components/ui/CodeInput';
import { Reveal } from '@/components/ui/Reveal';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { useAuth } from '@/store/useAuth';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function VerifyScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();

  const email = useAuth((s) => s.pendingConfirmation);
  const verifyOtp = useAuth((s) => s.verifyOtp);
  const resendOtp = useAuth((s) => s.resendOtp);
  const cancelConfirmation = useAuth((s) => s.cancelConfirmation);
  const clearError = useAuth((s) => s.clearError);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);

  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const ready = code.length === CODE_LENGTH;
  const attempted = useRef('');

  const submit = async (value: string) => {
    if (value.length !== CODE_LENGTH || busy) return;
    attempted.current = value;
    const ok = await verifyOtp(value);
    if (ok) haptic('success');
    else haptic('warning');
  };

  useEffect(() => {
    if (code.length === CODE_LENGTH && attempted.current !== code && !busy) {
      void submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, busy]);

  const resend = async () => {
    const ok = await resendOtp();
    if (ok) {
      haptic('success');
      setCooldown(RESEND_SECONDS);
      setCode('');
      attempted.current = '';
    }
  };

  return (
    <KeyboardAwareScrollView
      contentContainerStyle={{
        paddingTop: insets.top + space.xxl,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Reveal index={0} style={{ gap: space.sm }}>
        <VText variant="hero">Verify your account.</VText>
        <VText variant="body" secondary>
          Enter the {CODE_LENGTH}-digit code we sent to{' '}
          <VText variant="bodyMedium">{email ?? 'your inbox'}</VText> to verify your account.
        </VText>
      </Reveal>

      <Reveal index={1}>
        <CodeInput
          label="Code"
          value={code}
          onChangeText={(t) => {
            clearError();
            setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH));
          }}
          length={CODE_LENGTH}
          autoFocus
          editable={!busy}
          hint="It expires in about an hour."
        />
      </Reveal>

      {error ? (
        <Reveal index={2}>
          <Notice text={error} />
        </Reveal>
      ) : null}

      <Reveal index={3} style={{ gap: space.base }}>
        <Button
          label="Verify account"
          onPress={() => submit(code)}
          loading={busy}
          disabled={!ready || busy}
        />

        <Touchable
          onPress={resend}
          disabled={cooldown > 0 || busy}
          feedback="select"
          scaleTo={1}
          accessibilityLabel="Send a new code"
          style={styles.row}
        >
          <VText variant="caption" muted>
            {cooldown > 0 ? `You can ask for a new code in ${cooldown}s` : 'No code arrived?'}
          </VText>
          {cooldown > 0 ? null : (
            <VText variant="caption" color={c.primary}>
              {' '}
              Send another
            </VText>
          )}
        </Touchable>

        <Touchable
          onPress={cancelConfirmation}
          feedback="select"
          scaleTo={1}
          accessibilityLabel="Use a different email address"
          style={styles.row}
        >
          <VText variant="caption" color={c.primary}>
            Use a different email
          </VText>
        </Touchable>
      </Reveal>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 44 },
});