import type { RTCIceCandidateInit, RTCConfiguration } from '../main/webrtcTypes';

export interface Attachment {
  name: string;
  type: string;
  data: string; // base64
}

type SignalingEvent =
  | { type: 'STATUS';       status: string }
  | { type: 'AGENT_JOINED'; sessionId: string; controlType: string; iceConfig: RTCConfiguration }
  | { type: 'SIGNAL_ANSWER'; sdp: string }
  | { type: 'SIGNAL_ICE';   candidate: RTCIceCandidateInit }
  | { type: 'SESSION_ENDED' }
  | { type: 'CHAT_MESSAGE'; message: string; timestamp: string; attachment?: Attachment };

declare global {
  interface Window {
    agent: {
      onDeviceReady:    (cb: (data: { deviceId: string; sessionCode: string; serverUrl: string }) => void) => void;
      onDeviceError:    (cb: (data: { message: string }) => void) => void;
      onSignaling:      (cb: (event: SignalingEvent) => void) => void;
      sendOffer:        (sdp: string) => void;
      sendIce:          (candidate: RTCIceCandidateInit) => void;
      reportResolution: (w: number, h: number) => void;
      sendChat:         (message: string, attachment?: Attachment) => void;
      openFile:         () => Promise<Attachment | { error: string } | null>;
      endSession:       (sessionId?: string) => void;
      saveSettings:     (serverUrl: string) => void;
      getPrimaryScreen: () => Promise<{ width: number; height: number }>;
      minimizeWindow:   () => void;
      hideWindow:       () => void;
    };
    __iceConfig?: RTCConfiguration;
  }
}

export {};
