import type { BrowserWindow } from 'electron';

// Lazy-load robotjs so the app starts even if the native module is missing
// (happens before electron-rebuild has been run)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let robot: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  robot = require('robotjs');
  robot.setMouseDelay(0);
  robot.setKeyboardDelay(0);
  console.log('[Input] robotjs loaded');
} catch {
  console.warn('[Input] robotjs not available — run `npm run rebuild-native`. Input injection disabled.');
}

export type InputEvent =
  | { type: 'mouse_move';  payload: { x: number; y: number } }
  | { type: 'mouse_click'; payload: { x: number; y: number; button: number } }
  | { type: 'scroll';      payload: { x: number; y: number; deltaX: number; deltaY: number } }
  | { type: 'key_press';   payload: { key: string; ctrl: boolean; shift: boolean; alt: boolean } };

let screenW = 1920;
let screenH = 1080;

export function setScreenResolution(w: number, h: number): void {
  screenW = w;
  screenH = h;
}

function px(nx: number, total: number): number {
  return Math.round(Math.max(0, Math.min(1, nx)) * total);
}

export function handleInput(event: InputEvent, _win: BrowserWindow): void {
  if (!robot) return;

  try {
    switch (event.type) {
      case 'mouse_move': {
        const { x, y } = event.payload;
        robot.moveMouse(px(x, screenW), px(y, screenH));
        break;
      }

      case 'mouse_click': {
        const { x, y, button } = event.payload;
        robot.moveMouse(px(x, screenW), px(y, screenH));
        robot.mouseClick(button === 2 ? 'right' : 'left');
        break;
      }

      case 'scroll': {
        const { deltaY } = event.payload;
        const amount = Math.round(Math.abs(deltaY) / 100) || 1;
        if (deltaY > 0) {
          robot.scrollMouse(0, amount);
        } else {
          robot.scrollMouse(0, -amount);
        }
        break;
      }

      case 'key_press': {
        const { key, ctrl, shift, alt } = event.payload;
        const mapped = mapKey(key);
        if (!mapped) return;

        const modifiers: string[] = [];
        if (ctrl)  modifiers.push('control');
        if (shift) modifiers.push('shift');
        if (alt)   modifiers.push('alt');

        if (modifiers.length > 0) {
          robot.keyTap(mapped, modifiers);
        } else if (mapped.length === 1) {
          // Single printable char — use typeString for proper shift-key handling
          robot.typeString(mapped);
        } else {
          robot.keyTap(mapped);
        }
        break;
      }
    }
  } catch (err) {
    console.warn('[Input] Injection error:', (err as Error).message);
  }
}

// Map browser KeyboardEvent.key → robotjs key names
function mapKey(k: string): string | null {
  const map: Record<string, string> = {
    Enter: 'enter', Backspace: 'backspace', Delete: 'delete',
    Tab: 'tab', Escape: 'escape', ' ': 'space',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    Insert: 'insert', CapsLock: 'caps_lock',
    F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
    F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
    PrintScreen: 'printscreen', ScrollLock: 'scrolllock', Pause: 'pause',
    NumLock: 'numlock',
  };

  if (k in map) return map[k];
  // Single printable character — pass through directly
  if (k.length === 1) return k;
  return null;
}
