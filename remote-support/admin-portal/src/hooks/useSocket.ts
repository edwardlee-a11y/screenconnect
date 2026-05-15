import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

let sharedSocket: Socket | null = null;

export function useSocket(): Socket | null {
  const token = useAuthStore((s) => s.token);
  const ref = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;

    if (!sharedSocket || !sharedSocket.connected) {
      sharedSocket = io(import.meta.env.VITE_API_URL ?? '/', {
        auth: { token },
        transports: ['websocket'],
        autoConnect: true,
      });
    }

    ref.current = sharedSocket;

    return () => {
      // Don't disconnect on component unmount — keep shared connection alive
    };
  }, [token]);

  return ref.current;
}

export function disconnectSocket(): void {
  sharedSocket?.disconnect();
  sharedSocket = null;
}
