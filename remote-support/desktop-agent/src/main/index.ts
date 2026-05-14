import { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } from 'electron';
import * as path from 'path';
import { registerDevice, sendHeartbeat, deregisterDevice } from './deviceService';
import {
  startSignaling,
  sendOffer,
  sendIce,
  sendChat,
  endSession,
  disconnect,
  notifyResolution,
} from './signalingService';
import { config, saveConfig } from './config';
import type { RTCIceCandidateInit } from './webrtcTypes';

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let deviceId: string | null = null;
let sessionCode: string | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createWindow();
  setupTray();
  setupIpc();
  await initDevice();
});

app.on('window-all-closed', () => {
  // Keep running in tray — only quit via tray menu
});

app.on('before-quit', async () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (deviceId) await deregisterDevice(deviceId).catch(console.error);
  disconnect();
});

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow(): void {
  win = new BrowserWindow({
    width: 340,
    height: 420,
    resizable: false,
    frame: false,
    transparent: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Needed for desktopCapturer in renderer
      webSecurity: true,
    },
  });

  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  win.loadFile(rendererPath);

  win.on('close', (e) => {
    e.preventDefault();
    win?.hide();
  });
}

// ── System tray ───────────────────────────────────────────────────────────────
function setupTray(): void {
  // Placeholder icon — replace assets/icon.ico with your actual icon
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('RemoteSupport Agent');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open', click: () => win?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => win?.show());
}

// ── Device registration ────────────────────────────────────────────────────────
async function initDevice(): Promise<void> {
  try {
    const device = await registerDevice();
    deviceId = device.id;
    sessionCode = device.session_code;

    win?.webContents.send('device-ready', {
      deviceId,
      sessionCode,
      serverUrl: config.serverUrl,
    });

    startSignaling(deviceId, sessionCode, win!);

    // Heartbeat every 30s
    heartbeatTimer = setInterval(() => {
      if (deviceId) sendHeartbeat(deviceId).catch(console.error);
    }, 30_000);
  } catch (err) {
    console.error('[Agent] Registration failed:', err);
    win?.webContents.send('device-error', { message: (err as Error).message });
  }
}

// ── IPC handlers (renderer → main) ────────────────────────────────────────────
function setupIpc(): void {
  // Renderer sends WebRTC offer to relay to server
  ipcMain.on('signal:offer', (_e, { sdp }: { sdp: string }) => {
    if (sessionCode) sendOffer(sessionCode, sdp);
  });

  // Renderer sends its ICE candidates
  ipcMain.on('signal:ice', (_e, { candidate }: { candidate: RTCIceCandidateInit }) => {
    if (sessionCode) sendIce(sessionCode, candidate);
  });

  // Renderer reports screen resolution so input can be scaled
  ipcMain.on('screen:resolution', (_e, { width, height }: { width: number; height: number }) => {
    notifyResolution(width, height);
  });

  // Chat message typed by device user
  ipcMain.on('chat:send', (_e, { message }: { message: string }) => {
    if (sessionCode) sendChat(sessionCode, message);
  });

  // End session button
  ipcMain.on('session:end', (_e, { sessionId }: { sessionId?: string }) => {
    if (sessionCode) endSession(sessionCode, sessionId);
  });

  // Settings update (server URL)
  ipcMain.on('settings:save', (_e, { serverUrl }: { serverUrl: string }) => {
    saveConfig({ serverUrl });
    // Re-register with new server on next launch
  });

  // Get primary screen dimensions for desktopCapturer (renderer needs this)
  ipcMain.handle('screen:getPrimary', () => {
    const { width, height } = screen.getPrimaryDisplay().size;
    return { width, height };
  });

  // Window controls
  ipcMain.on('window:minimize', () => win?.minimize());
  ipcMain.on('window:hide',     () => win?.hide());
}
