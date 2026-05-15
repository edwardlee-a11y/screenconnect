/// <reference path="./global.d.ts" />
// Renderer process — WebRTC screen capture + UI

// ── State ─────────────────────────────────────────────────────────────────────
let sessionCode = '';
let currentSessionId: string | null = null;
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const codeDisplay    = document.getElementById('codeDisplay')!;
const statusDot      = document.getElementById('statusDot')!;
const statusText     = document.getElementById('statusText')!;
const sharingBadge   = document.getElementById('sharingBadge')!;
const btnStop        = document.getElementById('btnStop')!;
const chatMsgs       = document.getElementById('chatMsgs')!;
const chatInput      = document.getElementById('chatInput') as HTMLInputElement;
const chatAttach     = document.getElementById('chatAttach')!;
const chatSend       = document.getElementById('chatSend')!;
const serverUrlInput = document.getElementById('serverUrlInput') as HTMLInputElement;
const settingsPanel  = document.getElementById('settingsPanel')!;
const btnToggle      = document.getElementById('btnToggleSettings')!;
const btnSettings    = document.getElementById('btnSettings')!;
const btnSave        = document.getElementById('btnSaveSettings')!;

// ── UI helpers ────────────────────────────────────────────────────────────────
function setStatus(status: 'offline' | 'online' | 'session' | 'error', label: string): void {
  const cls = status === 'session' ? 'session' : status === 'online' ? 'online' : status === 'error' ? 'error' : '';
  statusDot.className = `status-dot ${cls}`;
  statusText.textContent = label;
}

let pendingAttachment: { name: string; type: string; data: string } | null = null;

function addSys(text: string): void {
  const el = document.createElement('div');
  el.className = 'msg-bubble msg-sys';
  el.textContent = text;
  chatMsgs.appendChild(el);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

function addMsg(role: 'agent' | 'device', text: string, attachment?: { name: string; type: string; data: string }): void {
  const el = document.createElement('div');
  el.className = `msg-bubble msg-${role}`;
  if (text) {
    const p = document.createElement('span');
    p.textContent = text;
    el.appendChild(p);
  }
  if (attachment) {
    if (attachment.type.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = `data:${attachment.type};base64,${attachment.data}`;
      img.className = 'chat-img';
      el.appendChild(img);
    } else {
      const a = document.createElement('a');
      a.href = `data:${attachment.type};base64,${attachment.data}`;
      a.download = attachment.name;
      a.textContent = `📄 ${attachment.name}`;
      a.className = 'chat-file';
      el.appendChild(a);
    }
  }
  chatMsgs.appendChild(el);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

// ── Main process callbacks ────────────────────────────────────────────────────
window.agent.onDeviceReady(({ sessionCode: code }) => {
  sessionCode = code;
  codeDisplay.textContent = code;
  setStatus('online', 'Online — waiting for agent');
  addSys('Ready. Share the code above with your support agent.');
});

window.agent.onDeviceError(({ message }) => {
  setStatus('error', 'Registration failed');
  addSys(`Error: ${message}`);
});

window.agent.onSignaling(async (event) => {
  switch (event.type) {
    case 'STATUS':
      if (event.status === 'online')  setStatus('online', 'Online — waiting for agent');
      else if (event.status === 'offline') setStatus('offline', 'Disconnected');
      else if (event.status === 'error')   setStatus('error', 'Connection error');
      break;

    case 'AGENT_JOINED':
      currentSessionId = event.sessionId;
      setStatus('session', 'Agent connected — starting screen share…');
      addSys(`Agent joined (${event.controlType})`);
      await startScreenShare(event.iceConfig).catch((err: Error) => {
        setStatus('error', 'Screen capture failed');
        addSys(`Error: ${err.message}`);
      });
      break;

    case 'SIGNAL_ANSWER':
      if (pc) {
        await pc.setRemoteDescription({ type: 'answer', sdp: event.sdp });
      }
      break;

    case 'SIGNAL_ICE':
      if (pc && event.candidate) {
        await pc.addIceCandidate(event.candidate as RTCIceCandidateInit).catch(() => { /* ignore */ });
      }
      break;

    case 'SESSION_ENDED':
      stopScreenShare();
      setStatus('online', 'Session ended — waiting for agent');
      addSys('Session ended by agent');
      currentSessionId = null;
      break;

    case 'CHAT_MESSAGE':
      addMsg('agent', event.message, event.attachment);
      break;
  }
});

// ── WebRTC screen share ───────────────────────────────────────────────────────
async function startScreenShare(iceConfig: RTCConfiguration): Promise<void> {
  const screen = await window.agent.getPrimaryScreen();
  window.agent.reportResolution(screen.width, screen.height);

  // In Electron renderer, desktopCapturer-based screen capture uses getUserMedia with chromeMediaSource
  localStream = await (navigator.mediaDevices as unknown as {
    getUserMedia(c: unknown): Promise<MediaStream>;
  }).getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        minWidth: screen.width, maxWidth: screen.width,
        minHeight: screen.height, maxHeight: screen.height,
      },
    },
  });

  pc = new RTCPeerConnection(iceConfig as RTCConfiguration);

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) window.agent.sendIce(e.candidate);
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      setStatus('session', 'Sharing screen…');
      sharingBadge.classList.add('active');
      btnStop.classList.remove('hidden');
    } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      stopScreenShare();
      setStatus('online', 'Connection lost — waiting for agent');
    }
  };

  const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
  await pc.setLocalDescription(offer);
  window.agent.sendOffer(offer.sdp!);
}

function stopScreenShare(): void {
  localStream?.getTracks().forEach((t) => t.stop());
  localStream = null;
  pc?.close();
  pc = null;
  sharingBadge.classList.remove('active');
  btnStop.classList.add('hidden');
}

// ── Chat ──────────────────────────────────────────────────────────────────────
chatAttach.addEventListener('click', async () => {
  const result = await window.agent.openFile();
  if (!result) return;
  if ('error' in result) { addSys(result.error); return; }
  pendingAttachment = result;
  addSys(`📎 ${result.name} ready — click send`);
});

function sendChat(): void {
  const text = chatInput.value.trim();
  if (!text && !pendingAttachment) return;
  const attachment = pendingAttachment ?? undefined;
  addMsg('device', text, attachment);
  window.agent.sendChat(text, attachment);
  chatInput.value = '';
  pendingAttachment = null;
}
chatSend.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

// ── Stop sharing ──────────────────────────────────────────────────────────────
btnStop.addEventListener('click', () => {
  window.agent.endSession(currentSessionId ?? undefined);
  stopScreenShare();
  setStatus('online', 'Session ended — waiting for agent');
  currentSessionId = null;
  addSys('You ended the session');
});

// ── Settings ──────────────────────────────────────────────────────────────────
let settingsOpen = false;
function toggleSettings(): void {
  settingsOpen = !settingsOpen;
  settingsPanel.className = 'settings' + (settingsOpen ? ' open' : '');
  btnToggle.textContent = settingsOpen ? '▾ Hide' : '▸ Show';
}
btnSettings.addEventListener('click', toggleSettings);
btnToggle.addEventListener('click', toggleSettings);
btnSave.addEventListener('click', () => {
  const url = serverUrlInput.value.trim();
  if (url) { window.agent.saveSettings(url); addSys('Settings saved — restart to reconnect'); toggleSettings(); }
});
