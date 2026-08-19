import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerWebPush(userId: string): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  if (!('PushManager' in window)) {
    console.warn('Push messaging is not supported in this browser.');
    return false;
  }

  if (!VAPID_PUBLIC_KEY) {
    console.warn('Missing EXPO_PUBLIC_VAPID_PUBLIC_KEY.');
    return false;
  }

  if (!supabase) {
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return false;
    }

    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys) return false;

    // Save subscription to Supabase
    const { error } = await supabase.from('web_push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subJson.endpoint,
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
      },
      { onConflict: 'endpoint' }
    );

    return !error;
  } catch (err) {
    console.error('Failed to register web push:', err);
    return false;
  }
}