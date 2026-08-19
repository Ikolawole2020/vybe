import React, { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { LiquidTabBar } from '@/components/nav/LiquidTabBar';
import { useVybe } from '@/store/useVybe';

export default function TabsLayout() {
  const sync = useVybe((s) => s.sync);

  /**
   * The one load that everything else assumes has happened.
   *
   * It lives here rather than on the feed because tabs mount lazily — someone
   * who opens straight onto their profile would otherwise see an empty account
   * until they wandered past the feed.
   */
  useEffect(() => {
    void sync();
  }, [sync]);

  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
      tabBar={(props) => <LiquidTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Feed' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
      <Tabs.Screen name="algo" options={{ title: 'Your Algo' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}
