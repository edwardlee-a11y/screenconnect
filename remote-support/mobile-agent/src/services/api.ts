import { Platform } from 'react-native';

// Default to localhost for dev — update via settings in the app
let SERVER_URL = __DEV__
  ? Platform.OS === 'android'
    ? 'http://10.0.2.2:4000'  // Android emulator → host machine
    : 'http://localhost:4000'
  : 'https://screenconnect-production.up.railway.app';

export function setServerUrl(url: string): void {
  SERVER_URL = url.replace(/\/$/, '');
}

export function getServerUrl(): string {
  return SERVER_URL;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type DevicePlatform = 'android' | 'ios';

export interface RegisteredDevice {
  id: string;
  name: string;
  session_code: string;
}

export async function registerDevice(
  name: string,
  platform: DevicePlatform,
): Promise<RegisteredDevice> {
  const os_version = `${Platform.OS} ${Platform.Version}`;
  const data = await apiFetch<{ device: RegisteredDevice; session_code: string }>(
    '/api/devices/register',
    {
      method: 'POST',
      body: JSON.stringify({ name, platform, os_version, agent_version: '1.0.0' }),
    },
  );
  return { ...data.device, session_code: data.session_code };
}

export async function sendHeartbeat(deviceId: string): Promise<void> {
  await apiFetch(`/api/devices/${deviceId}/heartbeat`, { method: 'PUT' }).catch(() => null);
}

export async function deregisterDevice(deviceId: string): Promise<void> {
  await apiFetch(`/api/devices/${deviceId}`, { method: 'DELETE' }).catch(() => null);
}
