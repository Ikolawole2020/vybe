import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, Touchable, VText, haptic } from '@/components/ui';
import { Field, Notice } from '@/components/ui/Field';
import { CodeInput } from '@/components/ui/CodeInput';
import { Reveal } from '@/components/ui/Reveal';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { useAuth } from '@/store/useAuth';

const CODE_LENGTH = 6;
const MIN_PASSWORD = 6;
/** Supabase rate-limits recovery emails. Asking again sooner only earns an error. */
const RESEND_SECONDS = 60;

/**
 * The reset itself: the code, then the new password.
 *
 * Reached by having a `recovery` in the store rather than by navigation — see
 * the guard in `(auth)/_layout.tsx` — and left the same way, by finishing or
 * cancelling. Both steps live on one screen because the second one is not a
 * place you can arrive at, leave, or come back to: the code has already been
 * spent by then, and a route that cannot be re-entered should not be a route.
 */
export default function ResetPasswordScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();

  const recovery = useAuth((s) => s.recovery);
  const verifyRecoveryCode = useAuth((s) => s.verifyRecoveryCode);
  const resendRecoveryCode = useAuth((s) => s.resendRecoveryCode);
  const setNewPassword = useAuth((s) => s.setNewPassword);
  const cancelRecovery = useAuth((s) => s.cancelRecovery);
  const clearError = useAuth((s) => s.clearError);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  const verified = recovery?.verified ?? false;

  // The code that brought the user here was already sent, so the timer starts
  // on arrival rather than on the first resend.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Guards the auto-submit below: without it, a wrong code re-submits itself on
  // every render for as long as six digits are sitting in the box.
  const attempted = useRef('');

  const submitCode = async (value: string) => {
    if (value.length !== CODE_LENGTH || busy) return;
    attempted.current = value;
    await verifyRecoveryCode(value);
  };

  // Typing the last digit is an unambiguous "done" — asking for a button tap
  // after it is a step that exists only because the form has one.
  useEffect(() => {
    if (!verified && code.length === CODE_LENGTH && attempted.current !== code && !busy) {
      void submitCode(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, busy, verified]);

  const resend = async () => {
    const ok = await resendRecoveryCode();
    if (ok) {
      haptic('success');
      setCooldown(RESEND_SECONDS);
      setCode('');
      attempted.current = '';
    }
  };

  const submitPassword = async () => {
    haptic('medium');
    // Nothing to navigate on success: clearing `recovery` opens the account
    // gate and the root layout moves on its own.
    await setNewPassword(password);
  };

  const ready = verified ? password.length >= MIN_PASSWORD : code.length === CODE_LENGTH;

  return (
    // Aware, not merely avoiding: this scrolls the focused field into view.
    // See the note on `KeyboardProvider` in `app/_layout.tsx`.
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
        <VText variant="hero">{verified ? 'Pick a new one.' : 'Check your email.'}</VText>
        <VText variant="body" secondary>
          {verified ? (
            'This replaces your old password everywhere. You will be signed in straight after.'
          ) : (
            <>
              We sent a {CODE_LENGTH}-digit code to{' '}
              <VText variant="bodyMedium">{recovery?.email ?? 'your inbox'}</VText>. Enter it to
              set a new password.
            </>
          )}
        </VText>
      </Reveal>

      <Reveal index={1}>
        {verified ? (
          <Field
            label="New password"
            value={password}
            onChangeText={(t) => {
              clearError();
              setPassword(t);
            }}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            secure
            autoCapitalize="none"
            textContentType="newPassword"
            returnKeyType="go"
            autoFocus
            editable={!busy}
            onSubmitEditing={() => {
              if (ready) void submitPassword();
            }}
            // Said here rather than after the fact: this is the moment the
            // decision is made, and the button is the thing that ends it.
            hint="If you use Face ID or fingerprint on this phone, turn it back on next time you sign in."
          />
        ) : (
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
        )}
      </Reveal>

      {error ? (
        <Reveal index={2}>
          <Notice text={error} />
        </Reveal>
      ) : null}

      <Reveal index={3} style={{ gap: space.base }}>
        <Button
          label={verified ? 'Save password' : 'Confirm'}
          onPress={() => (verified ? void submitPassword() : void submitCode(code))}
          loading={busy}
          disabled={!ready || busy}
        />

        {verified ? null : (
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
        )}

        <Touchable
          onPress={() => void cancelRecovery()}
          feedback="select"
          scaleTo={1}
          accessibilityLabel="Cancel and go back to sign in"
          style={styles.row}
        >
          <VText variant="caption" color={c.primary}>
            {verified ? 'Cancel — keep my old password' : 'Back to sign in'}
          </VText>
        </Touchable>
      </Reveal>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 44 },
});
