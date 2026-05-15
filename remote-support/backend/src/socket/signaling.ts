import type { Server as SocketServer, Socket } from 'socket.io';
import { supabase } from '../services/supabase';
import {
  getDeviceByCode,
  createSession,
  endSession,
  releaseCode,
} from '../services/sessionService';
import { config } from '../config';
import type { Device } from '../types/models';

interface DeviceEntry {
  deviceId: string;
  sessionCode: string;
  socketId: string;
  activeSessions: string[];
}

interface AgentEntry {
  userId: string;
  socketId: string;
}

interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

const deviceSockets = new Map<string, DeviceEntry>(); // deviceId → entry
const agentSockets = new Map<string, AgentEntry>();   // userId → entry
const codeToPeer = new Map<string, { deviceSocketId: string; agentSocketId?: string }>();

export function registerSignaling(io: SocketServer): void {
  const iceConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      ...(config.turn.url?.startsWith('turn:') || config.turn.url?.startsWith('turns:')
        ? [{ urls: config.turn.url, username: config.turn.username, credential: config.turn.credential }]
        : []),
    ],
  };

  io.on('connection', (socket: Socket) => {

    // ── Device agent registers ──────────────────────────────────────────────
    socket.on('device:register', (data: { deviceId: string; sessionCode: string }) => {
      const { deviceId, sessionCode } = data;
      deviceSockets.set(deviceId, { deviceId, sessionCode, socketId: socket.id, activeSessions: [] });
      codeToPeer.set(sessionCode, { deviceSocketId: socket.id });
      socket.join(`device:${deviceId}`);
      socket.emit('device:registered', { iceConfig });
      console.log(`[Device] ${deviceId} registered — code ${sessionCode}`);
    });

    // ── Agent joins a session by code ───────────────────────────────────────
    socket.on('agent:join', async (data: {
      sessionCode: string;
      userId: string;
      type: 'view_only' | 'full_control';
    }) => {
      const { sessionCode, userId, type } = data;
      const deviceId = getDeviceByCode(sessionCode);

      if (!deviceId) {
        socket.emit('error', { message: 'Invalid or expired session code' });
        return;
      }

      const peer = codeToPeer.get(sessionCode);
      if (!peer) {
        socket.emit('error', { message: 'Device not connected' });
        return;
      }

      agentSockets.set(userId, { userId, socketId: socket.id });
      peer.agentSocketId = socket.id;
      socket.join(`session:${sessionCode}`);

      const sessionId = await createSession(deviceId, userId, type).catch(() => null);

      const deviceEntry = deviceSockets.get(deviceId);
      if (deviceEntry && sessionId) deviceEntry.activeSessions.push(sessionId);

      await supabase.from('devices').update({ status: 'in_session' } as Partial<Device>).eq('id', deviceId);

      io.to(peer.deviceSocketId).emit('agent:joined', { sessionId, type, iceConfig });
      socket.emit('agent:joined', { sessionId, deviceId, iceConfig });
      console.log(`[Agent] ${userId} joined device ${deviceId} (${type})`);
    });

    // ── WebRTC signaling relay ──────────────────────────────────────────────
    socket.on('signal:offer', (data: { sessionCode: string; sdp: string }) => {
      const peer = codeToPeer.get(data.sessionCode);
      if (peer?.agentSocketId) {
        io.to(peer.agentSocketId).emit('signal:offer', { sdp: data.sdp, sessionCode: data.sessionCode });
      }
    });

    socket.on('signal:answer', (data: { sessionCode: string; sdp: string }) => {
      const peer = codeToPeer.get(data.sessionCode);
      if (peer?.deviceSocketId) {
        io.to(peer.deviceSocketId).emit('signal:answer', { sdp: data.sdp });
      }
    });

    socket.on('signal:ice', (data: { sessionCode: string; candidate: IceCandidate; from: 'device' | 'agent' }) => {
      const peer = codeToPeer.get(data.sessionCode);
      if (!peer) return;
      const target = data.from === 'device' ? peer.agentSocketId : peer.deviceSocketId;
      if (target) io.to(target).emit('signal:ice', { candidate: data.candidate });
    });

    // ── Remote control input (agent → device) ───────────────────────────────
    socket.on('control:input', (data: {
      sessionCode: string;
      type: 'mouse_move' | 'mouse_click' | 'key_press' | 'scroll';
      payload: Record<string, unknown>;
    }) => {
      const peer = codeToPeer.get(data.sessionCode);
      if (peer?.deviceSocketId) {
        io.to(peer.deviceSocketId).emit('control:input', { type: data.type, payload: data.payload });
      }
    });

    // ── Chat relay ──────────────────────────────────────────────────────────
    socket.on('chat:message', (data: { sessionCode: string; message: string; role: 'device' | 'agent'; attachment?: { name: string; type: string; data: string } }) => {
      const peer = codeToPeer.get(data.sessionCode);
      if (!peer) return;
      const targetSocketId = data.role === 'device' ? peer.agentSocketId : peer.deviceSocketId;
      if (targetSocketId) {
        io.to(targetSocketId).emit('chat:message', {
          message: data.message,
          role: data.role,
          timestamp: new Date().toISOString(),
          attachment: data.attachment,
        });
      }
    });

    // ── Session end ─────────────────────────────────────────────────────────
    socket.on('session:end', async (data: { sessionCode: string; sessionId?: string }) => {
      const peer = codeToPeer.get(data.sessionCode);
      if (!peer) return;

      if (data.sessionId) await endSession(data.sessionId).catch(console.error);

      io.to(`session:${data.sessionCode}`).emit('session:ended', { sessionCode: data.sessionCode });

      peer.agentSocketId = undefined;

      const deviceId = getDeviceByCode(data.sessionCode);
      if (deviceId) {
        await supabase.from('devices').update({ status: 'online' } as Partial<Device>).eq('id', deviceId);
      }
    });

    // ── Disconnect cleanup ──────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      for (const [deviceId, entry] of deviceSockets.entries()) {
        if (entry.socketId !== socket.id) continue;

        deviceSockets.delete(deviceId);
        codeToPeer.delete(entry.sessionCode);

        for (const sessionId of entry.activeSessions) {
          await endSession(sessionId).catch(console.error);
        }

        await supabase
          .from('devices')
          .update({ status: 'offline', session_code: null } as Partial<Device>)
          .eq('id', deviceId);

        releaseCode(entry.sessionCode);
        console.log(`[Device] ${deviceId} disconnected`);
        return;
      }

      for (const [userId, entry] of agentSockets.entries()) {
        if (entry.socketId !== socket.id) continue;
        agentSockets.delete(userId);
        console.log(`[Agent] ${userId} disconnected`);
        return;
      }
    });
  });
}

export function getConnectedDeviceCount(): number { return deviceSockets.size; }
export function getConnectedAgentCount(): number { return agentSockets.size; }
