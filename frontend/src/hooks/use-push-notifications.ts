import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// Call this after the user has authenticated and you have a session token.
// Example: useRegisterForPushNotifications(sessionToken)
export default function useRegisterForPushNotifications(sessionToken: string | null) {
  useEffect(() => {
    if (!sessionToken) return;

    let token: string | null = null;

    async function register() {
      try {
        if (!Device.isDevice) {
          console.warn('Must use physical device for Push Notifications');
          return;
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted') {
          console.warn('Failed to get push token for push notifications!');
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync();
        token = tokenData.data;

        // Send token to backend
        await fetch('/api/auth/push-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ token }),
        });

        // Android: set notification channel
        if (Platform.OS === 'android') {
          Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF231F7C',
          });
        }
      } catch (e) {
        console.warn('Error while registering for push notifications', e);
      }
    }

    register();

    // Clean up: unregister token on unmount (optional)
    return () => {
      if (!token) return;
      (async () => {
        try {
          await fetch('/api/auth/push-token/unregister', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({ token }),
          });
        } catch (e) {
          console.warn('Failed to unregister push token', e);
        }
      })();
    };
  }, [sessionToken]);
}
