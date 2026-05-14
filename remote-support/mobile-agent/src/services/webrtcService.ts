import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  type MediaStream,
  type MediaStreamTrack,
} from 'react-native-webrtc';
import type RTCIceCandidateEvent from 'react-native-webrtc/lib/typescript/RTCIceCandidateEvent';
import { Platform } from 'react-native';

export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

interface WebRTCCallbacks {
  onOffer:        (sdp: string) => void;
  onIceCandidate: (candidate: IceCandidate) => void;
  onStateChange:  (state: string) => void;
}

let pc: InstanceType<typeof RTCPeerConnection> | null = null;
let localStream: MediaStream | null = null;

export async function startScreenShare(
  iceConfig: RTCConfiguration,
  callbacks: WebRTCCallbacks,
): Promise<void> {
  await cleanup();

  // ── Capture screen ────────────────────────────────────────────────────────
  if (Platform.OS === 'android') {
    // Android: full system screen capture via MediaProjection
    localStream = await (mediaDevices as unknown as {
      getDisplayMedia(c: { video: boolean }): Promise<MediaStream>;
    }).getDisplayMedia({ video: true });
  } else {
    // iOS: ReplayKit broadcast is complex — use camera as placeholder
    // A production iOS app needs a Broadcast Extension target (outside Expo managed)
    localStream = await mediaDevices.getUserMedia({
      video: {
        facingMode: 'front',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  }

  // ── Build peer connection ─────────────────────────────────────────────────
  pc = new RTCPeerConnection(iceConfig);

  localStream.getTracks().forEach((track: MediaStreamTrack) => {
    pc!.addTrack(track, localStream!);
  });

  pc.addEventListener('icecandidate', (e: RTCIceCandidateEvent<'icecandidate'>) => {
    if (e.candidate) {
      callbacks.onIceCandidate({
        candidate: e.candidate.candidate,
        sdpMid: e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex,
      });
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    callbacks.onStateChange(pc?.connectionState ?? 'closed');
  });

  // ── Create offer ──────────────────────────────────────────────────────────
  const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
  await pc.setLocalDescription(new RTCSessionDescription(offer));
  callbacks.onOffer(offer.sdp!);
}

export async function applyAnswer(sdp: string): Promise<void> {
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
}

export async function addIceCandidate(candidate: IceCandidate): Promise<void> {
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch { /* ignore stale candidates */ }
}

export async function cleanup(): Promise<void> {
  localStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
  localStream = null;
  pc?.close();
  pc = null;
}
