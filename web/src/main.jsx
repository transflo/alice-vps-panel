import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './theme.js';
import { NotifyProvider } from './notify.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider theme={theme} noSsr>
      <CssBaseline enableColorScheme />
      <NotifyProvider>
        <App />
      </NotifyProvider>
    </ThemeProvider>
  </StrictMode>,
);
