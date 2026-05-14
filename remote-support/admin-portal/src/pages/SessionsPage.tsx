import { useEffect, useState } from 'react';
import { api, type Session } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import PlatformPill from '../components/PlatformPill';

function formatDuration(s: number | null): string {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.sessions.list({ limit: 100 })
      .then((r) => setSessions(r.sessions))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const active = sessions.filter((s) => s.status === 'active');

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Sessions</div>
          <div className="page-sub">{active.length} active · {sessions.length} total</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">No sessions yet</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {s.devices && <PlatformPill platform={s.devices.platform} />}
                        <span style={{ fontWeight: 500 }}>{s.devices?.name ?? s.device_id.slice(0, 8)}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        color: s.type === 'full_control' ? 'var(--accent2)' : 'var(--muted2)',
                      }}>
                        {s.type === 'full_control' ? 'Full Control' : 'View Only'}
                      </span>
                    </td>
                    <td><StatusBadge status={s.status} /></td>
                    <td style={{ fontSize: 12, color: 'var(--muted2)' }}>{formatDate(s.started_at)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {s.status === 'active'
                        ? <span style={{ color: 'var(--accent)' }}>Live</span>
                        : formatDuration(s.duration_seconds)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {s.ended_at ? formatDate(s.ended_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
