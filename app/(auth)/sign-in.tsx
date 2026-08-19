import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useRouter } from 'expo-router';
import { Button, Icon, Touchable, VText, haptic } from '@/components/ui';
import { BiometryIcon } from '@/components/ui/BiometryIcon';
import { Field, Notice } from '@/components/ui/Field';
import { Reveal } from '@/components/ui/Reveal';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';
import { isConfigured, useAuth } from '@/store/useAuth';
import { useVybe } from '@/store/useVybe';
import {
  checkBiometricsSupport,
  getRememberedEmail,
  type BiometryType,
} from '@/services/biometrics';

export default function SignInScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const signIn = useAuth((s) => s.signIn);
  const signInWithBiometrics = useAuth((s) => s.signInWithBiometrics);
  const enableBiometricSignIn = useAuth((s) => s.enableBiometricSignIn);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const clearError = useAuth((s) => s.clearError);
  const setTourExitScreen = useAuth((s) => s.setTourExitScreen);
  const replayTour = useVybe((s) => s.replayTour);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bioSupported, setBioSupported] = useState(false);
  const [biometryType, setBiometryType] = useState<BiometryType>('Biometrics');
  const [hasSavedCreds, setHasSavedCreds] = useState(false);

  useEffect(() => {
    let live = true;

    async function initBio() {
      const res = await checkBiometricsSupport();
      const savedEmail = await getRememberedEmail();

      if (!live) return;
      // Both, not either: hardware without an enrolled face or finger produces
      // a button whose only possible outcome is a failed prompt.
      setBioSupported(res.supported && res.enrolled);
      setBiometryType(res.biometryType);
      setHasSavedCreds(res.hasSavedCredentials);

      // Pre-filling the address is a convenience, not a claim that the account
      // is signed in — the password field stays empty and the credential behind
      // the button is only read after a successful prompt.
      if (savedEmail) setEmail(savedEmail);
    }

    void initBio();
    return () => {
      live = false;
    };
  }, []);

  const ready = email.includes('@') && password.length > 0;

  const handleBiometrics = async () => {
    haptic('light');
    clearError();
    await signInWithBiometrics();
  };

  /**
   * Signs in with the typed password, then offers to keep it for next time.
   *
   * The offer is a question rather than a side effect: saying yes writes the
   * password into the Keychain, and doing that to someone silently because they
   * logged in is not a decision the app gets to make for them. Asked once — if
   * there is already a saved credential there is nothing to ask about.
   */
  const handlePasswordSignIn = async () => {
    haptic('medium');
    const ok = await signIn(email, password);
    if (!ok || !bioSupported || hasSavedCreds) return;

    Alert.alert(
      `Use ${biometryType} next time?`,
      `Sign in with ${biometryType} instead of typing your password. It is kept in this device's secure keychain and never leaves the phone.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Turn on',
          onPress: () => {
            void enableBiometricSignIn(email, password).then((saved) => {
              if (saved) setHasSavedCreds(true);
            });
          },
        },
      ],
    );
  };

  const backToTour = () => {
    haptic('light');
    clearError();
    // Come back here, not to sign-up: stepping back to re-read what the app is
    // does not mean the person changed their mind about having an account.
    setTourExitScreen('sign-in');
    replayTour();
  };

  const goToForgotPassword = () => {
    haptic('light');
    clearError();
    // The address travels with the tap. Somebody who is here because their
    // password failed has already typed it once.
    router.push({
      pathname: '/(auth)/forgot-password',
      params: email.trim() ? { email: email.trim() } : undefined,
    });
  };

  const goToSignUp = () => {
    clearError();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.push('/(auth)/sign-up');
    }
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
      {/*
        Back goes to the tour — the screen that explains what this app is —
        rather than to whatever happens to be on the stack.

        It used to be `router.back()` behind a `canGoBack()` check, which meant
        the control was usually absent: the tour unmounts itself the moment it
        is finished, so `(auth)` is the root and there is nothing behind it. On
        the occasions it did appear, "back" from sign-in led to sign-up, which
        is a sideways step between two screens that already link to each other.

        `replayTour` clears the flag and the root layout swaps the screen out,
        because which screen follows from that flag is the layout's decision and
        duplicating it here is how the two drift apart. Same reason the tour's
        own finish button does not navigate either.
      */}
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
        <VText variant="hero">Welcome back.</VText>
        <VText variant="body" secondary>
          Your topics, dials and circles are on your account, not on this phone.
        </VText>
      </Reveal>

      <Reveal index={1} style={{ gap: space.base }}>
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
          placeholder="Your password"
          secure
          autoCapitalize="none"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => {
            if (ready) void handlePasswordSignIn();
          }}
          accessoryRight={
            bioSupported ? (
              <Touchable
                onPress={handleBiometrics}
                feedback="select"
                hitSlop={8}
                scaleTo={0.88}
                accessibilityLabel={`Sign in with ${biometryType}`}
                style={[
                  styles.faceIdFieldBtn,
                  { backgroundColor: hasSavedCreds ? c.volt : c.surface },
                ]}
              >
                <BiometryIcon
                  size={18}
                  type={biometryType}
                  color={hasSavedCreds ? c.onVolt : c.textSecondary}
                />
              </Touchable>
            ) : null
          }
        />

        {/* Under the field it is about, where somebody who has just failed to
            remember a password is already looking — not at the bottom of the
            screen next to "create an account", which is a different problem. */}
        <Touchable
          onPress={goToForgotPassword}
          feedback="select"
          scaleTo={1}
          accessibilityLabel="Reset your password"
          style={styles.forgot}
        >
          <VText variant="caption" color={c.primary}>
            Forgot password?
          </VText>
        </Touchable>
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
          label="Sign in"
          onPress={() => void handlePasswordSignIn()}
          loading={busy}
          disabled={!ready || busy}
        />

        {bioSupported ? (
          <Touchable
            onPress={handleBiometrics}
            feedback="light"
            scaleTo={0.97}
            accessibilityLabel={`Sign in with ${biometryType}`}
            style={[
              styles.faceIdRowBtn,
              {
                backgroundColor: hasSavedCreds ? c.surfaceElevated : 'transparent',
                borderColor: c.border,
              },
            ]}
          >
            <BiometryIcon
              size={20}
              type={biometryType}
              color={hasSavedCreds ? c.volt : c.textSecondary}
            />
            <VText variant="bodyMedium" color={hasSavedCreds ? c.text : c.textSecondary}>
              Sign in with {biometryType}
            </VText>
          </Touchable>
        ) : null}

        <Touchable
          onPress={goToSignUp}
          feedback="select"
          scaleTo={1}
          accessibilityLabel="Create an account instead"
          style={styles.switch}
        >
          <VText variant="caption" muted>
            No account yet?{' '}
          </VText>
          <VText variant="caption" color={c.primary}>
            Create one
          </VText>
        </Touchable>
      </Reveal>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  switch: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', minHeight: 44 },
  forgot: { alignSelf: 'flex-end', justifyContent: 'center', minHeight: 44 },
  faceIdFieldBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  faceIdRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
