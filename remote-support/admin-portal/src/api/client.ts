const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('rs_token');
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    me: () => request<{ user: User }>('/auth/me'),
  },

  admin: {
    dashboard: () => request<{ stats: DashboardStats }>('/admin/dashboard'),
    devices: () => request<{ devices: Device[] }>('/admin/devices'),
    users: () => request<{ users: User[] }>('/admin/users'),
    setRole: (id: string, role: UserRole) =>
      request<{ ok: boolean }>(`/admin/users/${id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }),
  },

  devices: {
    list: () => request<{ devices: Device[] }>('/devices'),
  },

  sessions: {
    list: (params?: { device_id?: string; limit?: number }) => {
      const q = new URLSearchParams(params as Record<string, string>).toString();
      return request<{ sessions: Session[] }>(`/sessions${q ? '?' + q : ''}`);
    },
    get: (id: string) => request<{ session: Session }>(`/sessions/${id}`),
  },
};

// ── Types shared with backend ─────────────────────────────────────────────────
export type DevicePlatform = 'windows' | 'mac' | 'linux' | 'android' | 'ios';
export type DeviceStatus  = 'online' | 'offline' | 'in_session';
export type SessionStatus = 'active' | 'ended' | 'failed';
export type SessionType   = 'view_only' | 'full_control';
export type UserRole      = 'admin' | 'agent';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at?: string;
}

export interface Device {
  id: string;
  name: string;
  platform: DevicePlatform;
  os_version: string;
  agent_version: string;
  status: DeviceStatus;
  ip_address: string | null;
  session_code: string | null;
  last_seen: string;
  created_at: string;
}

export interface Session {
  id: string;
  device_id: string;
  agent_id: string | null;
  type: SessionType;
  status: SessionStatus;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  devices?: { name: string; platform: DevicePlatform };
}

export interface DashboardStats {
  total_devices: number;
  total_sessions: number;
  active_sessions: number;
  devices_by_platform: Record<string, number>;
  devices_by_status: Record<string, number>;
}
