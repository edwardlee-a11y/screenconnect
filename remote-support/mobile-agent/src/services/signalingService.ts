import { io, type Socket } from 'socket.io-client';
import { getServerUrl } from './api';
import { useDeviceStore } from '../store/deviceStore';
import {
  startScreenShare,
  applyAnswer,
  addIceCandidate,
  cleanup as cleanupWebRTC,
} from './webrtcService';

let socket: Socket | null = null;

export function connect(deviceId: string, sessionCode: string): void {
  if (socket?.connected) socket.disconnect();

  socket = io(getServerUrl(), {
    transports: ['websocket'],
    autoConnect: true,
  });

  const store = useDeviceStore.getState();

  socket.on('connect', () => {
    socket!.emit('device:register', { deviceId, sessionCode });
    store.addChat({ role: 'sys', text: 'Connected to server', ts: now() });
  });

  socket.on('device:registered', (data: { iceConfig: RTCConfiguration }) => {
    store.setStatus('online');
    // Store ICE config for when agent joins
    pendingIceConfig = data.iceConfig;
  });

  socket.on('agent:joined', async (data: {
    sessionId: string;
    type: string;
    iceConfig: RTCConfiguration;
  }) => {
    store.setSessionId(data.sessionId);
    store.setStatus('agent_joined');
    store.addChat({ role: 'sys', text: `Agent connected (${data.type})`, ts: now() });

    await startScreenShare(data.iceConfig, {
      onOffer: (sdp) => {
        socket?.emit('signal:offer', { sessionCode, sdp });
        store.setStatus('sharing');
      },
      onIceCandidate: (candidate) => {
        socket?.emit('signal:ice', { sessionCode, candidate, from: 'device' });
      },
      onStateChange: (state) => {
        if (state === 'failed' || state === 'disconnected') {
          store.addChat({ role: 'sys', text: 'Screen share connection lost', ts: now() });
          store.setStatus('online');
        }
      },
    }).catch((err: Error) => {
      store.addChat({ role: 'sys', text: `Screen share error: ${err.message}`, ts: now() });
      store.setStatus('error', err.message);
    });
  });

  socket.on('signal:answer', async (data: { sdp: string }) => {
    await applyAnswer(data.sdp).catch(console.error);
  });

  socket.on('signal:ice', async (data: { candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }) => {
    await addIceCandidate(data.candidate).catch(console.error);
  });

  socket.on('chat:message', (data: { message: string; role: string; timestamp: string; attachment?: { name: string; type: string; data: string } }) => {
    if (data.role === 'agent') {
      store.addChat({ role: 'agent', text: data.message, ts: data.timestamp, attachment: data.attachment });
    }
  });

  socket.on('session:ended', () => {
    cleanupWebRTC().catch(console.error);
    store.clearSession();
    store.addChat({ role: 'sys', text: 'Session ended by agent', ts: now() });
  });

  socket.on('disconnect', () => {
    store.setStatus('offline');
    store.addChat({ role: 'sys', text: 'Disconnected from server', ts: now() });
  });

  socket.on('connect_error', (err) => {
    store.setStatus('error', err.message);
  });
}

export function sendChat(sessionCode: string, message: string, attachment?: { name: string; type: string; data: string }): void {
  socket?.emit('chat:message', { sessionCode, message, role: 'device', attachment });
}

export function endSession(sessionCode: string, sessionId?: string): void {
  socket?.emit('session:end', { sessionCode, sessionId });
  cleanupWebRTC().catch(console.error);
  useDeviceStore.getState().clearSession();
}

export function disconnect(): void {
  socket?.disconnect();
  socket = null;
  cleanupWebRTC().catch(console.error);
}

let pendingIceConfig: RTCConfiguration | null = null;
export function getPendingIceConfig(): RTCConfiguration | null { return pendingIceConfig; }

function now(): string { return new Date().toLocaleTimeString(); }
