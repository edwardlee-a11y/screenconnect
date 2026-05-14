// Minimal WebRTC type stubs for the main process.
// The main process never creates RTCPeerConnection — it only passes these objects
// through IPC/Socket.IO. The actual WebRTC lives in the renderer (Chromium).
export {};
