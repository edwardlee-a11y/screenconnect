import { customAlphabet } from 'nanoid';
import { supabase } from './supabase';
import type { Device, Session } from '../types/models';

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

// In-memory map: sessionCode → deviceId (fast lookup for signaling)
const codeToDevice = new Map<string, string>();

export async function assignSessionCode(deviceId: string): Promise<string> {
  let code: string;
  do {
    code = generateCode();
  } while (codeToDevice.has(code));

  codeToDevice.set(code, deviceId);

  await supabase
    .from('devices')
    .update({ session_code: code, status: 'online' } as Partial<Device>)
    .eq('id', deviceId);

  return code;
}

export function getDeviceByCode(code: string): string | undefined {
  return codeToDevice.get(code);
}

export function releaseCode(code: string): void {
  codeToDevice.delete(code);
}

export async function createSession(
  deviceId: string,
  agentId: string | null,
  type: 'view_only' | 'full_control',
): Promise<string> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      device_id: deviceId,
      agent_id: agentId,
      type,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return (data as Pick<Session, 'id'>).id;
}

export async function endSession(sessionId: string): Promise<void> {
  const { data } = await supabase
    .from('sessions')
    .select('started_at')
    .eq('id', sessionId)
    .single();

  const row = data as Pick<Session, 'started_at'> | null;
  const started = row?.started_at ? new Date(row.started_at) : new Date();
  const duration = Math.floor((Date.now() - started.getTime()) / 1000);

  await supabase
    .from('sessions')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
      duration_seconds: duration,
    } as Partial<Session>)
    .eq('id', sessionId);
}
