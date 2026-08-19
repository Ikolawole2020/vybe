import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useFonts } from 'expo-font';
import {
  Outfit_300Light,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { useVybe } from '@/store/useVybe';
import { isConfigured, useAuth } from '@/store/useAuth';
import { initAppRealtime } from '@/services/realtime';
import { registerPushToken } from '@/services/push';
import { registerWebPush } from '@/services/webPush';
import { SplashGate, SPLASH_BG } from '@/components/SplashGate';
import { InAppToastHost } from '@/components/ui/InAppToast';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * First run is four gates, in order: tour, account, setup, feed.
 *
 * They are expressed as `Stack.Protected` guards rather than a `replace()` in
 * an effect. The difference matters here — the flags this reads are restored
 * from disk asynchronously, so an effect that fires on mount decides against
 * defaults and cannot correct itself afterwards. A guard is re-evaluated on
 * every render, so the moment a flag lands the navigator moves.
 *
 * The four guards are mutually exclusive: exactly one entry screen exists at
 * any time, and flipping a flag is the only way to move between them. Nothing
 * navigates to these routes by hand.
 */
function Navigator() {
  const { c, isDark } = useTheme();
  const router = useRouter();

  const tourSeen = useVybe((s) => s.tourSeen);
  const onboardedFlag = useVybe((s) => s.onboarded);
  const onboardedFor = useVybe((s) => s.onboardedFor);
  const ageAskedFor = useVybe((s) => s.ageAskedFor);
  const authStatus = useAuth((s) => s.status);
  const userId = useAuth((s) => s.user?.id ?? null);
  const recovering = useAuth((s) => s.recovery !== null);

  useEffect(() => {
    if (userId) {
      const unsub = initAppRealtime(userId);
      // Registers native push token for handset builds (iOS/Android)
      void registerPushToken(userId);
      // Registers browser push subscription for Web/PWA
      void registerWebPush(userId);
      return unsub;
    }
  }, [userId]);

  /**
   * Tapping a push notification opens what it is about.
   *
   * Without this the banner is a dead end — it wakes the app to whatever screen
   * it was last on, which for a reply notification is rarely the thread.
   */
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/')) {
        router.push(url as never);
      }
    });
    return () => sub.remove();
  }, [router]);

  const needsAccount = isConfigured && (authStatus === 'signed-out' || recovering);
  const onboarded = needsAccount || !userId ? onboardedFlag : onboardedFlag && onboardedFor === userId;
  const needsAge = !needsAccount && Boolean(userId) && ageAskedFor !== userId;

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Protected guard={!tourSeen}>
          <Stack.Screen name="tour" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>

        <Stack.Protected guard={tourSeen && needsAccount}>
          <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        </Stack.Protected>

        <Stack.Protected guard={tourSeen && needsAge}>
          <Stack.Screen name="age" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>

        <Stack.Protected guard={tourSeen && !needsAccount && !needsAge && !onboarded}>
          <Stack.Screen name="setup" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="personalizing" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>

        <Stack.Protected guard={tourSeen && !needsAccount && !needsAge && onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="compose"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="circles" />
          <Stack.Screen name="algo-advanced" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="edit-profile" />
          <Stack.Screen name="people" />
          <Stack.Screen name="ledger" options={{ presentation: 'modal' }} />
          <Stack.Screen name="post/[id]" />
          <Stack.Screen
            name="photo/[id]"
            options={{
              presentation: 'fullScreenModal',
              animation: 'fade',
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
          <Stack.Screen
            name="story/[id]"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
          <Stack.Screen
            name="story/create"
            options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="messages/index" />
          <Stack.Screen name="messages/[id]" />
          <Stack.Screen name="profile-view/[id]" />
          <Stack.Screen name="room/[id]" />
        </Stack.Protected>
      </Stack>

      <InAppToastHost />
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Outfit_300Light,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  const hydrated = useVybe((s) => s.hydrated);
  const authStatus = useAuth((s) => s.status);
  const init = useAuth((s) => s.init);

  const [splashDone, setSplashDone] = useState(false);
  const onSplashDone = useCallback(() => setSplashDone(true), []);

  useEffect(() => {
    init();
  }, [init]);

  const ready = (loaded || error) && hydrated && authStatus !== 'loading';

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: SPLASH_BG }}>
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
          <ThemeProvider>
            {ready ? <Navigator /> : null}
            {!(ready && splashDone) ? <SplashGate onDone={onSplashDone} /> : null}
          </ThemeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}