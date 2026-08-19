import React from 'react';
import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useAuth } from '@/store/useAuth';

export default function AuthLayout() {
  const { c } = useTheme();
  const pending = useAuth((s) => s.pendingConfirmation);
  const recovering = useAuth((s) => s.recovery !== null);
  const authInitialScreen = useAuth((s) => s.authInitialScreen);

  return (
    <Stack
      initialRouteName={authInitialScreen}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: c.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Protected guard={!pending && !recovering}>
        <Stack.Screen name="sign-in" options={{ animation: 'fade' }} />
        <Stack.Screen name="sign-up" options={{ animation: 'fade' }} />
        {/* The only screen in the group that is navigated to rather than
            guarded into — it is a step away from sign-in, not a state. */}
        <Stack.Screen name="forgot-password" />
      </Stack.Protected>

      <Stack.Protected guard={!!pending}>
        <Stack.Screen name="verify" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack.Protected>

      {/* No back gesture, for the same reason verify has none: the way out is
          finishing or the cancel control, both of which clear the state this
          guard reads. A swipe would leave the flow open behind an empty stack. */}
      <Stack.Protected guard={recovering}>
        <Stack.Screen
          name="reset-password"
          options={{ animation: 'fade', gestureEnabled: false }}
        />
      </Stack.Protected>
    </Stack>
  );
}
