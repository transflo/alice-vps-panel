import Box from '@mui/material/Box';

export default function Logo({ size = 32 }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: size / 4 + 'px',
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        display: 'grid',
        placeItems: 'center',
        fontWeight: 800,
        fontSize: size * 0.48,
        flex: 'none',
      }}
    >
      A
    </Box>
  );
}
