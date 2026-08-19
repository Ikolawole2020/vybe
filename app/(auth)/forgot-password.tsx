import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { Field, Notice } from '@/components/ui/Field';
import { Reveal } from '@/components/ui/Reveal';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { isConfigured, useAuth } from '@/store/useAuth';

/**
 * Asks which account to reset.
 *
 * Pushed from sign-in, and it leaves by setting `recovery` — the guard in
 * `(auth)/_layout.tsx` swaps this whole group for the reset screen, the same way
 * a pending confirmation swaps sign-up for verify.
 */
export default function ForgotPasswordScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const requestPasswordReset = useAuth((s) => s.requestPasswordReset);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);

  // Sign-in hands over whatever was typed there. Somebody who got their password
  // wrong knows their address, and asking for it twice is a step with no answer
  // they have not already given.
  const { email: prefill } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(prefill ?? '');

  useEffect(() => clearError, [clearError]);

  const ready = email.includes('@');

  const submit = async () => {
    haptic('medium');
    await requestPasswordReset(email);
  };

  const back = () => {
    clearError();
    if (router.canGoBack()) router.back();
    else router.replace('/(auth)/sign-in');
  };

  return (
    // Aware, not merely avoiding: this scrolls the focused field into view.
    // See the note on `KeyboardProvider` in `app/_layout.tsx`.
    <KeyboardAwareScrollView
      contentContainerStyle={{
        paddingTop: insets.top + space.base,
        paddingBottom: insets.bottom + space.xl,
        paddingHorizontal: space.lg,
        gap: space.lg,
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Touchable
        onPress={back}
        feedback="light"
        hitSlop={10}
        scaleTo={0.9}
        accessibilityLabel="Back to sign in"
        style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
      >
        <Icon name="chevron-left" size={24} color={c.text} />
      </Touchable>

      <Reveal index={0} style={{ gap: space.sm }}>
        <VText variant="hero">Reset your password.</VText>
        <VText variant="body" secondary>
          Tell us the address on the account and we will send a six-digit code to it.
        </VText>
      </Reveal>

      <Reveal index={1}>
        <Field
          label="Email"
          value={email}
          onChangeText={(t) => {
            clearError();
            setEmail(t);
          }}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="go"
          autoFocus={!prefill}
          onSubmitEditing={() => {
            if (ready) void submit();
          }}
        />
      </Reveal>

      {error ? (
        <Reveal index={2}>
          <Notice text={error} />
        </Reveal>
      ) : null}

      {!isConfigured ? (
        <Reveal index={2}>
          <Notice text="No Supabase project configured. Add your keys to .env and restart Metro with --clear." />
        </Reveal>
      ) : null}

      <Reveal index={3} style={{ gap: space.base }}>
        <Button
          label="Send code"
          onPress={() => void submit()}
          loading={busy}
          disabled={!ready || busy}
        />

        <Touchable
          onPress={back}
          feedback="select"
          scaleTo={1}
          accessibilityLabel="Back to sign in"
          style={styles.row}
        >
          <VText variant="caption" muted>
            Remembered it?{' '}
          </VText>
          <VText variant="caption" color={c.primary}>
            Sign in
          </VText>
        </Touchable>
      </Reveal>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 44 },
});
