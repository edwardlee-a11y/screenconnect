// Sends push notifications via the Expo Push API (works on both iOS and Android).
// No SDK required — plain HTTP POST.

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendExpoPush(
  tokens: string[],
  message: PushMessage,
): Promise<void> {
  const valid = tokens.filter((t) => t.startsWith('ExponentPushToken['));
  if (valid.length === 0) return;

  const messages = valid.map((to) => ({
    to,
    title: message.title,
    body:  message.body,
    data:  message.data ?? {},
    sound: message.sound ?? 'default',
  }));

  try {
    await fetch(EXPO_PUSH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (err) {
    console.warn('[push] Failed to send push notifications:', err);
  }
}
