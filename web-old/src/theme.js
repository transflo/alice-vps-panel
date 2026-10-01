import { createTheme } from '@mui/material/styles';

export const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

// 浅色 / 深色跟随系统设置切换（CSS 变量 + prefers-color-scheme）。
const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#5b5bd6' },
        background: { default: '#f4f5f8', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#9394f8' },
        background: { default: '#0e1015', paper: '#161920' },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: [
      'system-ui',
      '-apple-system',
      '"Segoe UI"',
      '"PingFang SC"',
      '"Hiragino Sans GB"',
      '"Microsoft YaHei"',
      'sans-serif',
    ].join(','),
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiCard: { defaultProps: { variant: 'outlined' } },
    MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit', position: 'sticky' } },
    MuiTextField: { defaultProps: { fullWidth: true } },
    MuiDialog: { defaultProps: { fullWidth: true } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});

export default theme;
