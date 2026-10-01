import { createContext, useCallback, useContext, useState } from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';

const NotifyContext = createContext(() => {});

// 右下角的操作提示。notify(text, severity) 中 severity 为 success / info / warning / error。
export function NotifyProvider({ children }) {
  const [msg, setMsg] = useState({ open: false, text: '', severity: 'info', key: 0 });

  const notify = useCallback((text, severity = 'info') => {
    setMsg({ open: true, text, severity, key: Date.now() + Math.random() });
  }, []);

  const close = (_, reason) => {
    if (reason === 'clickaway') return;
    setMsg((m) => ({ ...m, open: false }));
  };

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        key={msg.key}
        open={msg.open}
        autoHideDuration={msg.severity === 'error' ? 6000 : 3500}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={msg.severity} variant="filled" onClose={close} sx={{ width: '100%' }}>
          {msg.text}
        </Alert>
      </Snackbar>
    </NotifyContext.Provider>
  );
}

export function useNotify() {
  return useContext(NotifyContext);
}
