import * as os from 'os';
import { config } from './config';

export interface DeviceInfo {
  id: string;
  name: string;
  session_code: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${config.serverUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function registerDevice(): Promise<DeviceInfo> {
  const platform = getPlatform();
  const name = os.hostname();
  const os_version = `${os.type()} ${os.release()}`;

  const data = await apiFetch<{ device: DeviceInfo; session_code: string }>('/api/devices/register', {
    method: 'POST',
    body: JSON.stringify({ name, platform, os_version, agent_version: '1.0.0' }),
  });

  return { ...data.device, session_code: data.session_code };
}

export async function sendHeartbeat(deviceId: string): Promise<void> {
  await apiFetch(`/api/devices/${deviceId}/heartbeat`, { method: 'PUT' }).catch(console.error);
}

export async function deregisterDevice(deviceId: string): Promise<void> {
  await apiFetch(`/api/devices/${deviceId}`, { method: 'DELETE' }).catch(console.error);
}

function getPlatform(): 'windows' | 'mac' | 'linux' {
  switch (process.platform) {
    case 'win32':  return 'windows';
    case 'darwin': return 'mac';
    default:       return 'linux';
  }
}
