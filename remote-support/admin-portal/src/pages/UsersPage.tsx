import { useEffect, useState } from 'react';
import { api, type User, type UserRole } from '../api/client';
import { useAuthStore } from '../store/authStore';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const currentUser = useAuthStore((s) => s.user);

  useEffect(() => {
    api.admin.users()
      .then((r) => setUsers(r.users))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const setRole = async (id: string, role: UserRole) => {
    setUpdating(id);
    try {
      await api.admin.setRole(id, role);
      setUsers((u) => u.map((usr) => usr.id === id ? { ...usr, role } : usr));
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update role');
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Users</div>
          <div className="page-sub">{users.length} agent account{users.length !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : users.length === 0 ? (
          <div className="empty-state">No users yet</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent2), var(--accent))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#fff', fontWeight: 600, fontSize: 11, flexShrink: 0,
                        }}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 500 }}>{u.name}</div>
                          {u.id === currentUser?.id && (
                            <div style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>You</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted2)' }}>{u.email}</td>
                    <td>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: u.role === 'admin' ? 'rgba(0,119,255,.12)' : 'var(--panel2)',
                        color: u.role === 'admin' ? 'var(--accent2)' : 'var(--muted2)',
                        border: `1px solid ${u.role === 'admin' ? 'rgba(0,119,255,.2)' : 'var(--border)'}`,
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted2)' }}>
                      {u.created_at ? formatDate(u.created_at) : '—'}
                    </td>
                    <td>
                      {u.id !== currentUser?.id && (
                        <button
                          className="btn btn-secondary btn-sm"
                          disabled={updating === u.id}
                          onClick={() => setRole(u.id, u.role === 'admin' ? 'agent' : 'admin')}
                        >
                          {updating === u.id
                            ? '…'
                            : u.role === 'admin'
                              ? 'Demote to Agent'
                              : 'Promote to Admin'}
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
