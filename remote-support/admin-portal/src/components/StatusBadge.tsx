import type { DeviceStatus, SessionStatus } from '../api/client';

interface Props {
  status: DeviceStatus | SessionStatus | string;
}

const MAP: Record<string, string> = {
  online:     'badge badge-online',
  offline:    'badge badge-offline',
  in_session: 'badge badge-session',
  active:     'badge badge-active',
  ended:      'badge badge-ended',
  failed:     'badge badge-offline',
};

const LABEL: Record<string, string> = {
  online:     'Online',
  offline:    'Offline',
  in_session: 'In Session',
  active:     'Active',
  ended:      'Ended',
  failed:     'Failed',
};

export default function StatusBadge({ status }: Props) {
  return (
    <span className={MAP[status] ?? 'badge badge-offline'}>
      {LABEL[status] ?? status}
    </span>
  );
}
