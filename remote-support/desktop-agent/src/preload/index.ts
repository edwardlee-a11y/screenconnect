import { contextBridge, ipcRenderer } from 'electron';
import type { RTCIceCandidateInit } from '../main/webrtcTypes';

interface Attachment { name: string; type: string; data: string; }

contextBridge.exposeInMainWorld('agent', {
  // ── Main → Renderer events ───────────────────────────────────────────────
  onDeviceReady: (cb: (data: { deviceId: string; sessionCode: string; serverUrl: string }) => void) =>
    ipcRenderer.on('device-ready', (_e, data) => cb(data)),

  onDeviceError: (cb: (data: { message: string }) => void) =>
    ipcRenderer.on('device-error', (_e, data) => cb(data)),

  onSignaling: (cb: (event: unknown) => void) =>
    ipcRenderer.on('signaling', (_e, event) => cb(event)),

  // ── Renderer → Main ──────────────────────────────────────────────────────
  sendOffer:      (sdp: string) =>
    ipcRenderer.send('signal:offer', { sdp }),

  sendIce:        (candidate: RTCIceCandidateInit) =>
    ipcRenderer.send('signal:ice', { candidate }),

  reportResolution: (width: number, height: number) =>
    ipcRenderer.send('screen:resolution', { width, height }),

  sendChat: (message: string, attachment?: Attachment) =>
    ipcRenderer.send('chat:send', { message, attachment }),

  openFile: () =>
    ipcRenderer.invoke('file:open') as Promise<Attachment | { error: string } | null>,

  endSession:     (sessionId?: string) =>
    ipcRenderer.send('session:end', { sessionId }),

  saveSettings:   (serverUrl: string) =>
    ipcRenderer.send('settings:save', { serverUrl }),

  getPrimaryScreen: () =>
    ipcRenderer.invoke('screen:getPrimary') as Promise<{ width: number; height: number }>,

  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  hideWindow:     () => ipcRenderer.send('window:hide'),
});

// Type declaration for window.agent (used in renderer.ts)
export {};
