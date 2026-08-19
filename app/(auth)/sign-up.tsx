import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { Field, Notice } from '@/components/ui/Field';
import { Reveal } from '@/components/ui/Reveal';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { isConfigured, useAuth } from '@/store/useAuth';
import { useVybe } from '@/store/useVybe';

export default function SignUpScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const signUp = useAuth((s) => s.signUp);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);
  const setTourExitScreen = useAuth((s) => s.setTourExitScreen);
  const replayTour = useVybe((s) => s.replayTour);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const ready =
    name.trim().length > 1 &&
    email.includes('@') &&
    password.length >= 6 &&
    passwordsMatch;

  const submit = async () => {
    if (!passwordsMatch) return;
    haptic('medium');
    await signUp(email, password, name);
  };

  const backToTour = () => {
    haptic('light');
    clearError();
    setTourExitScreen('sign-up');
    replayTour();
  };

  return (
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
        onPress={backToTour}
        feedback="light"
        hitSlop={10}
        scaleTo={0.9}
        accessibilityLabel="Back to what Vybe is"
        style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
      >
        <Icon name="chevron-left" size={24} color={c.text} />
      </Touchable>

      <Reveal index={0} style={{ gap: space.sm }}>
        <VText variant="hero">Make an account.</VText>
        <VText variant="body" secondary>
          Next you will set what goes in your feed. It takes about a minute and you can change
          every part of it later.
        </VText>
      </Reveal>

      <Reveal index={1} style={{ gap: space.base }}>
        <Field
          label="Name"
          value={name}
          onChangeText={(t) => {
            clearError();
            setName(t);
          }}
          placeholder="What people will see"
          autoCapitalize="words"
          textContentType="name"
          returnKeyType="next"
        />
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
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={(t) => {
            clearError();
            setPassword(t);
          }}
          placeholder="At least 6 characters"
          secure
          autoCapitalize="none"
          textContentType="newPassword"
          returnKeyType="next"
        />
        <Field
          label="Confirm password"
          value={confirmPassword}
          onChangeText={(t) => {
            clearError();
            setConfirmPassword(t);
          }}
          placeholder="Type it again"
          secure
          autoCapitalize="none"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => ready && submit()}
        />
        {confirmPassword.length > 0 && !passwordsMatch ? (
          <Notice text="Passwords do not match." />
        ) : null}
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
          label="Create account"
          onPress={submit}
          loading={busy}
          disabled={!ready || busy}
        />

        <Touchable
          onPress={() => {
            clearError();
            if (router.canGoBack()) {
              router.back();
            } else {
              router.push('/(auth)/sign-in');
            }
          }}
          feedback="select"
          scaleTo={1}
          accessibilityLabel="Sign in instead"
          style={styles.switch}
        >
          <VText variant="caption" muted>
            Already have an account?{' '}
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
  switch: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 44 },
});