import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { api } from './api/client';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import DevicesPage from './pages/DevicesPage';
import SessionsPage from './pages/SessionsPage';
import ViewerPage from './pages/ViewerPage';
import UsersPage from './pages/UsersPage';

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { token, user, setAuth, logout } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    // Only hydrate from server when token exists but user was lost (page refresh)
    if (user) return;
    api.auth.me()
      .then(({ user: u }) => setAuth(token, u))
      .catch(() => { logout(); navigate('/login'); });
  // Only run on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/devices"   element={<DevicesPage />} />
          <Route path="/sessions"  element={<SessionsPage />} />
          <Route path="/viewer"    element={<ViewerPage />} />
          <Route path="/users"     element={<UsersPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
