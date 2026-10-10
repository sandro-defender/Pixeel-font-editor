/** MUI theme for Pixeel: the app's orange/blue palette in light and dark modes. */
import { createTheme } from '@mui/material/styles';

export type ThemeMode = 'light' | 'dark';

export function createAppTheme(mode: ThemeMode) {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#f0703d' : '#d94f1e', contrastText: '#ffffff' },
      secondary: { main: dark ? '#6ba2ff' : '#2c6cdf', contrastText: '#ffffff' },
      success: { main: dark ? '#4cc38a' : '#1d8a4e' },
      warning: { main: dark ? '#e0a94f' : '#b07714' },
      error: { main: dark ? '#ef6b78' : '#c62838' },
      info: { main: dark ? '#6ba2ff' : '#2c6cdf' },
      background: {
        default: dark ? '#14161c' : '#f4f4f7',
        paper: dark ? '#1d2029' : '#ffffff',
      },
      divider: dark ? '#343a4c' : '#d8dbe3',
      text: {
        primary: dark ? '#e8eaf2' : '#1c2030',
        secondary: dark ? '#98a0b5' : '#5b6272',
      },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiButton: {
        defaultProps: { size: 'small', variant: 'outlined', color: 'inherit' },
      },
      MuiIconButton: { defaultProps: { size: 'small' } },
      MuiToggleButton: { defaultProps: { size: 'small' } },
      MuiToggleButtonGroup: { defaultProps: { size: 'small' } },
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiPaper: { defaultProps: { variant: 'outlined', elevation: 0 } },
      MuiChip: { defaultProps: { size: 'small', variant: 'outlined' } },
      MuiTooltip: { defaultProps: { enterDelay: 400, arrow: true } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 48 } } },
    },
  });
}
