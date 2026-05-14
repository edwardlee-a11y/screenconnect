import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Device } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import PlatformPill from '../components/PlatformPill';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type Filter = 'all' | 'online' | 'offline' | 'in_session';

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.admin.devices()
      .then((r) => setDevices(r.devices))
      .catch(console.error)
      .finally(() => setLoading(false));

    const t = setInterval(() => {
      api.admin.devices().then((r) => setDevices(r.devices)).catch(() => null);
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  const filtered = devices.filter((d) => {
    if (filter !== 'all' && d.status !== filter) return false;
    if (search && !d.name.toLowerCase().includes(search.toLowerCase()) &&
        !d.ip_address?.includes(search)) return false;
    return true;
  });

  const counts = {
    all: devices.length,
    online: devices.filter((d) => d.status === 'online').length,
    in_session: devices.filter((d) => d.status === 'in_session').length,
    offline: devices.filter((d) => d.status === 'offline').length,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Devices</div>
          <div className="page-sub">{devices.length} device{devices.length !== 1 ? 's' : ''} registered</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'online', 'in_session', 'offline'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: filter === f ? 'var(--accent)' : 'var(--panel)',
              color: filter === f ? '#000' : 'var(--muted2)',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              cursor: 'pointer',
            }}
          >
            {f.replace('_', ' ')} ({counts[f]})
          </button>
        ))}
        <input
          className="input"
          placeholder="Search by name or IP…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', width: 220 }}
        />
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">No devices found</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Session Code</th>
                  <th>IP Address</th>
                  <th>Last Seen</th>
                  <th>Agent</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => (
                  <tr key={device.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{device.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                        {device.os_version}
                      </div>
                    </td>
                    <td><PlatformPill platform={device.platform} /></td>
                    <td><StatusBadge status={device.status} /></td>
                    <td>
                      {device.session_code ? (
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--accent)', letterSpacing: 2 }}>
                          {device.session_code}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)' }}>
                      {device.ip_address ?? '—'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted2)' }}>{timeAgo(device.last_seen)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                      v{device.agent_version}
                    </td>
                    <td>
                      {device.status === 'online' && device.session_code && (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => navigate(`/viewer?code=${device.session_code ?? ''}`)}
                        >
                          Connect
                        </button>
                      )}
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
