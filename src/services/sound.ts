import { Audio } from 'expo-av';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

// ─── Haptics ───────────────────────────────────────────────────────────────

const HAPTIC_OPTIONS = { enableVibrateFallback: true, ignoreAndroidSystemSettings: false };

export const Haptics = {
  spinStart: () => ReactNativeHapticFeedback.trigger('impactLight',  HAPTIC_OPTIONS),
  win:       () => ReactNativeHapticFeedback.trigger('notificationSuccess', HAPTIC_OPTIONS),
  lose:      () => ReactNativeHapticFeedback.trigger('notificationError',   HAPTIC_OPTIONS),
  jackpot:   () => ReactNativeHapticFeedback.trigger('impactHeavy',  HAPTIC_OPTIONS),
  tap:       () => ReactNativeHapticFeedback.trigger('impactLight',  HAPTIC_OPTIONS),
};

// ─── Sounds ────────────────────────────────────────────────────────────────
// Add .mp3 files to assets/sounds/ and uncomment the require() lines below.

type SoundKey = 'spin' | 'win' | 'lose' | 'jackpot';

const SOUND_FILES: Record<SoundKey, number | null> = {
  spin:    null, // require('../../assets/sounds/spin.mp3'),
  win:     null, // require('../../assets/sounds/win.mp3'),
  lose:    null, // require('../../assets/sounds/lose.mp3'),
  jackpot: null, // require('../../assets/sounds/jackpot.mp3'),
};

const loaded: Partial<Record<SoundKey, Audio.Sound>> = {};
let audioEnabled = true;

export async function loadSounds(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    for (const [key, file] of Object.entries(SOUND_FILES) as [SoundKey, number | null][]) {
      if (!file) continue;
      try {
        const { sound } = await Audio.Sound.createAsync(file, { shouldPlay: false, volume: 0.8 });
        loaded[key] = sound;
      } catch {
        // file missing or unreadable — skip silently
      }
    }
  } catch {
    audioEnabled = false;
  }
}

export async function unloadSounds(): Promise<void> {
  for (const sound of Object.values(loaded)) {
    try { await sound.unloadAsync(); } catch { /* ignore */ }
  }
}

async function play(key: SoundKey): Promise<void> {
  if (!audioEnabled) return;
  const sound = loaded[key];
  if (!sound) return;
  try {
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch { /* ignore */ }
}

export const Sounds = {
  spin:    () => play('spin'),
  win:     () => play('win'),
  lose:    () => play('lose'),
  jackpot: () => play('jackpot'),
};
