import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { disconnectSocket } from '../hooks/useSocket';

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/devices',   label: 'Devices',   icon: '⬜' },
  { to: '/sessions',  label: 'Sessions',  icon: '◈' },
  { to: '/viewer',    label: 'Viewer',    icon: '⬡' },
  { to: '/users',     label: 'Users',     icon: '◉' },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate('/login');
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        background: 'var(--panel)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '0',
        overflow: 'hidden',
      }}>
        {/* Logo */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid var(--border)',
          fontFamily: 'var(--mono)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--accent)',
          letterSpacing: 2,
        }}>
          REMOTESUPPORT <span style={{ color: 'var(--muted)', fontWeight: 400 }}>// Admin</span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                color: isActive ? 'var(--accent)' : 'var(--muted2)',
                background: isActive ? 'rgba(0,229,160,.08)' : 'transparent',
                transition: 'all .15s',
              })}
            >
              <span style={{ fontSize: 14, opacity: 0.7 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div style={{
          padding: '14px 16px',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 600, fontSize: 12, flexShrink: 0,
          }}>
            {user?.name?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }} className="truncate">{user?.name ?? '—'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{user?.role}</div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              background: 'none', border: 'none', color: 'var(--muted)',
              fontSize: 16, lineHeight: 1, padding: 4, cursor: 'pointer',
            }}
            title="Logout"
          >
            ⏻
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ overflow: 'auto', padding: '28px 32px', background: 'var(--bg)' }}>
        <Outlet />
      </main>
    </div>
  );
}
