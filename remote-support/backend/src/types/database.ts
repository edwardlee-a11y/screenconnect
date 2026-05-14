export type DevicePlatform = 'windows' | 'mac' | 'linux' | 'android' | 'ios';
export type DeviceStatus = 'online' | 'offline' | 'in_session';
export type SessionStatus = 'active' | 'ended' | 'failed';
export type SessionType = 'view_only' | 'full_control';
export type UserRole = 'admin' | 'agent';

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          password_hash: string;
          name: string;
          role: UserRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          password_hash: string;
          name: string;
          role?: UserRole;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          password_hash?: string;
          name?: string;
          role?: UserRole;
          created_at?: string;
        };
      };
      devices: {
        Row: {
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
        };
        Insert: {
          id?: string;
          name: string;
          platform: DevicePlatform;
          os_version: string;
          agent_version: string;
          status?: DeviceStatus;
          ip_address?: string | null;
          session_code?: string | null;
          last_seen?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          platform?: DevicePlatform;
          os_version?: string;
          agent_version?: string;
          status?: DeviceStatus;
          ip_address?: string | null;
          session_code?: string | null;
          last_seen?: string;
          created_at?: string;
        };
      };
      sessions: {
        Row: {
          id: string;
          device_id: string;
          agent_id: string | null;
          type: SessionType;
          status: SessionStatus;
          started_at: string;
          ended_at: string | null;
          duration_seconds: number | null;
        };
        Insert: {
          id?: string;
          device_id: string;
          agent_id?: string | null;
          type: SessionType;
          status?: SessionStatus;
          started_at?: string;
          ended_at?: string | null;
          duration_seconds?: number | null;
        };
        Update: {
          id?: string;
          device_id?: string;
          agent_id?: string | null;
          type?: SessionType;
          status?: SessionStatus;
          started_at?: string;
          ended_at?: string | null;
          duration_seconds?: number | null;
        };
      };
      session_events: {
        Row: {
          id: string;
          session_id: string;
          event_type: string;
          data: Record<string, unknown>;
          timestamp: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          event_type: string;
          data?: Record<string, unknown>;
          timestamp?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          event_type?: string;
          data?: Record<string, unknown>;
          timestamp?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
