import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api } from './api.js';
import Logo from './Logo.jsx';

export default function LoginPage({ message, onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(message || '');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api('POST', '/api/login', { password });
      onLogin();
    } catch (ex) {
      setError(ex.message);
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 380 }}>
        <CardContent component="form" onSubmit={submit} sx={{ p: 4, '&:last-child': { pb: 4 } }}>
          <Stack spacing={2.5} sx={{ alignItems: 'center' }}>
            <Logo size={48} />
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>Alice 面板</Typography>
              <Typography variant="body2" color="text.secondary">EVO 实例管理</Typography>
            </Box>
            <TextField
              type="password"
              label="管理密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
            {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}
            <Button type="submit" variant="contained" size="large" fullWidth loading={submitting}>
              登录
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
