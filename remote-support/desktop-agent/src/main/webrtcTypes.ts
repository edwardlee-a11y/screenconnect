// Minimal WebRTC type stubs for the main process.
// The main process never creates RTCPeerConnection — it only passes these objects
// through IPC/Socket.IO. The actual WebRTC lives in the renderer (Chromium).

export interface RTCConfiguration {
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
  rtcpMuxPolicy?: 'require';
}

export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface RTCIceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}
