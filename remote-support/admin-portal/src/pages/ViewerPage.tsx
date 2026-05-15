import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

type ConnState = 'idle' | 'connecting' | 'waiting' | 'negotiating' | 'streaming' | 'ended' | 'error';

interface Attachment { name: string; type: string; data: string; }

interface ChatMsg {
  role: 'agent' | 'device' | 'sys';
  text: string;
  ts: string;
  attachment?: Attachment;
}

export default function ViewerPage() {
  const [searchParams] = useSearchParams();
  const { token, user } = useAuthStore();

  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [state, setState] = useState<ConnState>('idle');
  const [error, setError] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [msg, setMsg] = useState('');
  const [pendingFile, setPendingFile] = useState<Attachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionCodeRef = useRef('');

  const addSys = (text: string) =>
    setChat((c) => [...c, { role: 'sys', text, ts: new Date().toLocaleTimeString() }]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = () => {
    const sessionCode = code.trim().toUpperCase();
    if (!sessionCode || !token || !user) return;

    cleanup();
    sessionCodeRef.current = sessionCode;
    setState('connecting');
    setError('');
    setChat([]);

    const backendUrl = import.meta.env.VITE_API_URL ?? 'https://screenconnect-production.up.railway.app';
    const socket = io(backendUrl, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      addSys('Connected to server');
      socket.emit('agent:join', { sessionCode, userId: user.id, type: 'full_control' });
      setState('waiting');
    });

    socket.on('connect_error', (err) => {
      setError(err.message);
      setState('error');
    });

    // Server confirms join + sends ICE config
    socket.on('agent:joined', (data: { sessionId: string; iceConfig: RTCConfiguration }) => {
      setSessionId(data.sessionId);
      addSys('Waiting for device to send screen…');
      initPeerConnection(socket, data.iceConfig, sessionCode);
    });

    socket.on('error', (data: { message: string }) => {
      setError(data.message);
      setState('error');
    });

    socket.on('signal:offer', async (data: { sdp: string }) => {
      const pc = pcRef.current;
      if (!pc) return;
      setState('negotiating');
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal:answer', { sessionCode, sdp: answer.sdp });
    });

    socket.on('signal:ice', async (data: { candidate: RTCIceCandidateInit }) => {
      try { await pcRef.current?.addIceCandidate(data.candidate); } catch { /* ignore */ }
    });

    socket.on('chat:message', (data: { message: string; role: string; timestamp: string; attachment?: Attachment }) => {
      if (data.role === 'device') {
        setChat((c) => [...c, { role: 'device', text: data.message, ts: new Date(data.timestamp).toLocaleTimeString(), attachment: data.attachment }]);
      }
    });

    socket.on('session:ended', () => {
      addSys('Session ended by device');
      setState('ended');
      cleanup();
    });

    socket.on('disconnect', () => {
      if (state !== 'ended') addSys('Disconnected from server');
    });
  };

  const initPeerConnection = (socket: Socket, iceConfig: RTCConfiguration, sessionCode: string) => {
    const pc = new RTCPeerConnection(iceConfig);
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('signal:ice', { sessionCode, candidate: e.candidate, from: 'agent' });
      }
    };

    pc.ontrack = (e) => {
      if (videoRef.current && e.streams[0]) {
        videoRef.current.srcObject = e.streams[0];
        setState('streaming');
        addSys('Screen share started');
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        setError('WebRTC connection failed — device may be behind a strict NAT (TURN server needed)');
        setState('error');
      }
      if (pc.connectionState === 'disconnected') {
        addSys('Connection lost');
      }
    };
  };

  // ── End session ────────────────────────────────────────────────────────────
  const endSession = () => {
    socketRef.current?.emit('session:end', { sessionCode: sessionCodeRef.current, sessionId });
    setState('ended');
    cleanup();
    addSys('Session ended');
  };

  // ── File pick ──────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { addSys('File too large (max 2 MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setPendingFile({ name: file.name, type: file.type, data: base64 });
      addSys(`📎 ${file.name} ready — click send`);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ── Send chat ──────────────────────────────────────────────────────────────
  const sendChat = () => {
    const text = msg.trim();
    if (!text && !pendingFile) return;
    if (!socketRef.current) return;
    const attachment = pendingFile ?? undefined;
    socketRef.current.emit('chat:message', { sessionCode: sessionCodeRef.current, message: text, role: 'agent', attachment });
    setChat((c) => [...c, { role: 'agent', text, ts: new Date().toLocaleTimeString(), attachment }]);
    setMsg('');
    setPendingFile(null);
  };

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat]);

  // ── Keyboard forward (agent clicks the video and types) ───────────────────
  const handleVideoKey = (e: React.KeyboardEvent) => {
    if (state !== 'streaming' || !socketRef.current) return;
    socketRef.current.emit('control:input', {
      sessionCode: sessionCodeRef.current,
      type: 'key_press',
      payload: { key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
    });
  };

  const handleVideoMouse = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (state !== 'streaming' || !socketRef.current || !videoRef.current) return;
    const rect = videoRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const type = e.type === 'mousemove' ? 'mouse_move' : 'mouse_click';
    socketRef.current.emit('control:input', {
      sessionCode: sessionCodeRef.current,
      type,
      payload: { x, y, button: e.button },
    });
  };

  const isConnected = state === 'waiting' || state === 'negotiating' || state === 'streaming' || state === 'connecting';

  return (
    <div style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column' }}>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <div className="page-title">Session Viewer</div>
          <div className="page-sub">Connect to a device using its 6-character session code</div>
        </div>
      </div>

      {/* Code entry bar */}
      {!isConnected && state !== 'ended' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
          <input
            className="input"
            style={{ maxWidth: 200, letterSpacing: 3, fontFamily: 'var(--mono)', fontSize: 18, textTransform: 'uppercase', textAlign: 'center' }}
            placeholder="A1B2C3"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
          />
          <button className="btn btn-primary" onClick={connect} disabled={code.length < 4}>
            Connect
          </button>
          {error && (
            <span style={{ fontSize: 13, color: 'var(--danger)' }}>{error}</span>
          )}
        </div>
      )}

      {/* Session layout */}
      {isConnected && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, minHeight: 0 }}>

          {/* Screen panel */}
          <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Toolbar */}
            <div style={{
              height: 46,
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 14px',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                <span>SCREEN SHARE</span>
                {state === 'streaming' && (
                  <span style={{ background: 'var(--warn)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                    LIVE
                  </span>
                )}
                {state === 'waiting' && <span>Waiting for device…</span>}
                {state === 'negotiating' && <span>Negotiating…</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setFullscreen(!fullscreen)}>
                  {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                </button>
                <button className="btn btn-danger btn-sm" onClick={endSession}>
                  End
                </button>
              </div>
            </div>

            {/* Video */}
            <div style={{
              flex: 1,
              background: '#080a0d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {state !== 'streaming' && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  <div className="spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
                  <span>Awaiting screen share…</span>
                </div>
              )}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                style={{
                  display: state === 'streaming' ? 'block' : 'none',
                  width: '100%', height: '100%',
                  objectFit: 'contain',
                  cursor: 'crosshair',
                  outline: 'none',
                }}
                tabIndex={0}
                onKeyDown={handleVideoKey}
                onMouseMove={(e) => e.buttons > 0 && handleVideoMouse(e)}
                onClick={handleVideoClick}
              />
              <div style={{
                position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,.6)',
                border: '1px solid var(--border)',
                borderRadius: 6, padding: '4px 10px',
                fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)',
              }}>
                Full Control · Click to focus
              </div>
            </div>
          </div>

          {/* Chat panel */}
          <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
              CHAT · {sessionCodeRef.current}
            </div>

            <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chat.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === 'agent' ? 'flex-end' : m.role === 'sys' ? 'center' : 'flex-start',
                  maxWidth: '85%',
                }}>
                  {m.role === 'sys' ? (
                    <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', textAlign: 'center' }}>{m.text}</div>
                  ) : (
                    <div>
                      <div style={{
                        background: m.role === 'agent' ? 'rgba(0,229,160,.08)' : 'var(--panel2)',
                        border: `1px solid ${m.role === 'agent' ? 'rgba(0,229,160,.2)' : 'var(--border)'}`,
                        borderRadius: 8, padding: '8px 10px',
                        fontSize: 12, color: m.role === 'agent' ? '#c0f0d8' : 'var(--text)',
                      }}>
                        {m.text && <div>{m.text}</div>}
                        {m.attachment && (
                          m.attachment.type.startsWith('image/') ? (
                            <img src={`data:${m.attachment.type};base64,${m.attachment.data}`}
                              alt={m.attachment.name}
                              style={{ maxWidth: '100%', maxHeight: 160, borderRadius: 4, marginTop: m.text ? 6 : 0, display: 'block' }} />
                          ) : (
                            <a href={`data:${m.attachment.type};base64,${m.attachment.data}`}
                              download={m.attachment.name}
                              style={{ fontSize: 11, color: 'var(--accent)', display: 'block', marginTop: m.text ? 4 : 0 }}>
                              📄 {m.attachment.name}
                            </a>
                          )
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)', textAlign: m.role === 'agent' ? 'right' : 'left' }}>
                        {m.ts}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
              <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx,.txt" style={{ display: 'none' }} onChange={handleFileChange} />
              <button title="Attach file" onClick={() => fileInputRef.current?.click()}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: pendingFile ? 'var(--accent)' : 'var(--muted2)', padding: '0 2px' }}>
                📎
              </button>
              <input
                className="input"
                style={{ fontSize: 12, flex: 1 }}
                placeholder="Type a message…"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
              />
              <button className="btn btn-primary btn-sm" onClick={sendChat}>→</button>
            </div>
          </div>
        </div>
      )}

      {state === 'ended' && (
        <div className="card">
          <div className="empty-state">
            <span style={{ fontSize: 24 }}>✓</span>
            Session ended
            <button className="btn btn-secondary btn-sm" onClick={() => { setState('idle'); setChat([]); }}>
              New Session
            </button>
          </div>
        </div>
      )}

      {state === 'idle' && !code && (
        <div className="card">
          <div className="empty-state">
            Enter a 6-character session code to connect to a device
          </div>
        </div>
      )}
    </div>
  );

  function handleVideoClick(e: React.MouseEvent<HTMLVideoElement>) {
    handleVideoMouse(e);
    (e.currentTarget as HTMLVideoElement).focus();
  }
}
