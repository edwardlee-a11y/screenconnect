import type { DevicePlatform } from '../api/client';

const ICONS: Record<DevicePlatform, string> = {
  windows: '⊞',
  mac:     '',
  linux:   '🐧',
  android: '🤖',
  ios:     '',
};

export default function PlatformPill({ platform }: { platform: DevicePlatform }) {
  return (
    <span className="platform-pill">
      <span>{ICONS[platform] ?? '?'}</span>
      {platform}
    </span>
  );
}
