import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { setUnauthorizedHandler } from './api.js';
import { clearCache } from './data.js';
import LoginPage from './LoginPage.jsx';
import Dashboard from './Dashboard.jsx';

export default function App() {
  const [session, setSession] = useState({ checked: false, authenticated: false, configured: true, message: '' });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearCache();
      setSession((s) => ({ ...s, authenticated: false, message: '登录已失效，请重新登录' }));
    });
    fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((s) => setSession({ checked: true, authenticated: Boolean(s.authenticated), configured: s.configured !== false, message: '' }))
      .catch(() => setSession({ checked: true, authenticated: false, configured: true, message: '无法连接面板服务' }));
  }, []);

  if (!session.checked) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!session.authenticated) {
    return (
      <LoginPage
        message={session.message}
        onLogin={() => setSession((s) => ({ ...s, authenticated: true, message: '' }))}
      />
    );
  }

  return (
    <Dashboard
      configured={session.configured}
      onLogout={() => {
        clearCache();
        setSession((s) => ({ ...s, authenticated: false, message: '' }));
      }}
    />
  );
}
