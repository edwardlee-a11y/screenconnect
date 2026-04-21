import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch } from '../services/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  return tokenData.data;
}

export function usePushNotifications(): void {
  useEffect(() => {
    registerForPushNotifications()
      .then((token) => {
        if (token) {
          apiFetch('/api/v1/auth/push-token', {
            method: 'POST',
            body: JSON.stringify({ token }),
          }).catch(() => {});
        }
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      // Future: navigate to the relevant screen based on notification.request.content.data
    });

    return () => sub.remove();
  }, []);
}
