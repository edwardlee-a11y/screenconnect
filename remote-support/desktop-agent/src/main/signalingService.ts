import { io, type Socket } from 'socket.io-client';
import type { BrowserWindow } from 'electron';
import { config } from './config';
import { handleInput, setScreenResolution, type InputEvent } from './inputService';
import type { RTCConfiguration, RTCIceCandidateInit } from './webrtcTypes';

type SignalingEvent =
  | { type: 'STATUS'; status: string }
  | { type: 'AGENT_JOINED'; sessionId: string; controlType: string; iceConfig: RTCConfiguration }
  | { type: 'SIGNAL_ANSWER'; sdp: string }
  | { type: 'SIGNAL_ICE'; candidate: RTCIceCandidateInit }
  | { type: 'SESSION_ENDED' }
  | { type: 'CHAT_MESSAGE'; message: string; timestamp: string };

let socket: Socket | null = null;

export function startSignaling(
  deviceId: string,
  sessionCode: string,
  win: BrowserWindow,
): void {
  if (socket?.connected) socket.disconnect();

  socket = io(config.serverUrl, { transports: ['websocket'], autoConnect: true });

  socket.on('connect', () => {
    console.log('[Signaling] Connected');
    socket!.emit('device:register', { deviceId, sessionCode });
  });

  socket.on('device:registered', (data: { iceConfig: RTCConfiguration }) => {
    console.log('[Signaling] Registered — ICE config received');
    sendToRenderer(win, { type: 'STATUS', status: 'online' });
    // Store ICE config for when agent joins
    win.webContents.executeJavaScript(
      `window.__iceConfig = ${JSON.stringify(data.iceConfig)};`,
    ).catch(console.error);
  });

  socket.on('agent:joined', (data: { sessionId: string; type: string; iceConfig: RTCConfiguration }) => {
    console.log(`[Signaling] Agent joined — session ${data.sessionId} (${data.type})`);
    sendToRenderer(win, {
      type: 'AGENT_JOINED',
      sessionId: data.sessionId,
      controlType: data.type,
      iceConfig: data.iceConfig,
    });
  });

  socket.on('signal:answer', (data: { sdp: string }) => {
    sendToRenderer(win, { type: 'SIGNAL_ANSWER', sdp: data.sdp });
  });

  socket.on('signal:ice', (data: { candidate: RTCIceCandidateInit }) => {
    sendToRenderer(win, { type: 'SIGNAL_ICE', candidate: data.candidate });
  });

  socket.on('control:input', (data: InputEvent) => {
    handleInput(data, win);
  });

  socket.on('chat:message', (data: { message: string; role: string; timestamp: string }) => {
    if (data.role === 'agent') {
      sendToRenderer(win, { type: 'CHAT_MESSAGE', message: data.message, timestamp: data.timestamp });
    }
  });

  socket.on('session:ended', () => {
    sendToRenderer(win, { type: 'SESSION_ENDED' });
  });

  socket.on('disconnect', () => {
    console.log('[Signaling] Disconnected');
    sendToRenderer(win, { type: 'STATUS', status: 'offline' });
  });

  socket.on('connect_error', (err) => {
    console.error('[Signaling] Connection error:', err.message);
    sendToRenderer(win, { type: 'STATUS', status: 'error' });
  });
}

// Called by renderer via IPC when it generates a WebRTC offer
export function sendOffer(sessionCode: string, sdp: string): void {
  socket?.emit('signal:offer', { sessionCode, sdp });
}

// Called by renderer via IPC for ICE candidates
export function sendIce(sessionCode: string, candidate: RTCIceCandidateInit): void {
  socket?.emit('signal:ice', { sessionCode, candidate, from: 'device' });
}

// Called by renderer when screen resolution is known
export function notifyResolution(w: number, h: number): void {
  setScreenResolution(w, h);
}

export function sendChat(sessionCode: string, message: string): void {
  socket?.emit('chat:message', { sessionCode, message, role: 'device' });
}

export function endSession(sessionCode: string, sessionId?: string): void {
  socket?.emit('session:end', { sessionCode, sessionId });
}

export function disconnect(): void {
  socket?.disconnect();
  socket = null;
}

function sendToRenderer(win: BrowserWindow, event: SignalingEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send('signaling', event);
  }
}
