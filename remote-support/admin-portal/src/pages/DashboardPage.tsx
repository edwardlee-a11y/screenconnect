import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type DashboardStats, type Device } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import PlatformPill from '../components/PlatformPill';

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api.admin.dashboard(), api.admin.devices()])
      .then(([d, devRes]) => {
        setStats(d.stats);
        setDevices(devRes.devices);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Refresh every 15s
    const t = setInterval(() => {
      api.admin.dashboard().then((d) => setStats(d.stats)).catch(() => null);
      api.admin.devices().then((d) => setDevices(d.devices)).catch(() => null);
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return <div className="loading-center"><div className="spinner" /></div>;
  }

  const online = devices.filter((d) => d.status === 'online' || d.status === 'in_session');

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Overview of all connected devices and sessions</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/viewer')}>
          + New Session
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        <div className="stat-card">
          <div className="stat-label">Total Devices</div>
          <div className="stat-value">{stats?.total_devices ?? 0}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Online Now</div>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>
            {(stats?.devices_by_status?.online ?? 0) + (stats?.devices_by_status?.in_session ?? 0)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Sessions</div>
          <div className="stat-value" style={{ color: 'var(--accent2)' }}>
            {stats?.active_sessions ?? 0}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Sessions</div>
          <div className="stat-value">{stats?.total_sessions ?? 0}</div>
        </div>
      </div>

      {/* Platform breakdown */}
      {stats && Object.keys(stats.devices_by_platform).length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12, color: 'var(--muted2)' }}>
            Devices by Platform
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(stats.devices_by_platform).map(([platform, count]) => (
              <div key={platform} style={{
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <PlatformPill platform={platform as Device['platform']} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live devices */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            Connected Devices
            {online.length > 0 && (
              <span style={{
                marginLeft: 8,
                background: 'rgba(0,229,160,.12)',
                color: 'var(--accent)',
                fontSize: 11,
                fontFamily: 'var(--mono)',
                padding: '2px 7px',
                borderRadius: 10,
              }}>
                {online.length} online
              </span>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/devices')}>
            View all →
          </button>
        </div>

        {devices.length === 0 ? (
          <div className="card">
            <div className="empty-state">No devices registered yet</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {devices.slice(0, 12).map((device) => (
              <DeviceCard key={device.id} device={device} onConnect={() => navigate(`/viewer?code=${device.session_code ?? ''}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeviceCard({ device, onConnect }: { device: Device; onConnect: () => void }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 14 }} className="truncate">{device.name}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            {device.os_version}
          </div>
        </div>
        <StatusBadge status={device.status} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <PlatformPill platform={device.platform} />
        {device.ip_address && (
          <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            {device.ip_address}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {device.session_code ? (
          <span style={{
            fontFamily: 'var(--mono)',
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: 3,
            color: 'var(--accent)',
          }}>
            {device.session_code}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>No code</span>
        )}
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{timeAgo(device.last_seen)}</span>
      </div>

      {(device.status === 'online') && (
        <button className="btn btn-primary btn-sm w-full" onClick={onConnect}>
          Connect
        </button>
      )}
      {device.status === 'in_session' && (
        <button className="btn btn-secondary btn-sm w-full" disabled>
          In Session
        </button>
      )}
    </div>
  );
}
