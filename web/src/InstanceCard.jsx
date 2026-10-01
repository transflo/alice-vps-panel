import { useEffect, useState } from 'react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PowerOffIcon from '@mui/icons-material/PowerOff';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import TerminalIcon from '@mui/icons-material/Terminal';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { monoFont } from './theme.js';
import { cardStatus, copyText, fmtDate, fmtRemaining, statusInfo } from './utils.js';
import { useNotify } from './notify.jsx';

const TONE_COLOR = { ok: 'success', busy: 'warning', off: 'default', bad: 'error', muted: 'default' };

export function StatusChip({ status }) {
  const st = statusInfo(status);
  const icon = st.tone === 'busy'
    ? <CircularProgress size={10} color="inherit" />
    : <FiberManualRecordIcon sx={{ fontSize: '10px !important' }} />;
  return <Chip size="small" color={TONE_COLOR[st.tone]} variant={st.tone === 'ok' || st.tone === 'bad' ? 'filled' : 'outlined'} icon={icon} label={st.label} sx={{ fontWeight: 600, flex: 'none' }} />;
}

function Countdown({ to }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = to.getTime() - now;
  const color = left <= 0 ? 'error' : left < 3600 * 1000 ? 'warning' : 'default';
  return <Chip size="small" variant={color === 'default' ? 'outlined' : 'filled'} color={color} label={fmtRemaining(left)} sx={{ ml: 1, height: 22 }} />;
}

function IpRow({ label, value }) {
  const notify = useNotify();
  if (!value) return null;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 34, flex: 'none' }}>{label}</Typography>
      <Typography sx={{ fontFamily: monoFont, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {value}
      </Typography>
      <Tooltip title={`复制 ${label}`}>
        <IconButton
          size="small"
          aria-label={`复制 ${label}`}
          onClick={async () => {
            const ok = await copyText(value);
            notify(ok ? `已复制 ${label}` : '复制失败，请手动复制', ok ? 'success' : 'error');
          }}
        >
          <ContentCopyIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

const MENU = [
  { action: 'poweroff', label: '强制关机', icon: <PowerOffIcon fontSize="small" /> },
  { action: 'renew', label: '续期', icon: <ScheduleIcon fontSize="small" /> },
  { action: 'rebuild', label: '重装系统', icon: <SettingsBackupRestoreIcon fontSize="small" /> },
  { action: 'exec', label: '执行命令', icon: <TerminalIcon fontSize="small" /> },
  { action: 'details', label: '详细信息', icon: <InfoOutlinedIcon fontSize="small" /> },
];

export default function InstanceCard({ inst, power, busy, onAction }) {
  const [anchor, setAnchor] = useState(null);
  const disabled = busy || !inst.id;
  const run = (action) => {
    setAnchor(null);
    onAction(action, inst);
  };

  const chips = [inst.plan, inst.os, inst.specs, inst.cpuName].filter((x) => x !== undefined && x !== '');

  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }} data-instance={inst.id}>
      {busy && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />}
      <CardContent sx={{ pb: 1.5, flex: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'flex-start', mb: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inst.name || `实例 #${inst.id}`}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {[`#${inst.id}`, inst.region].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <StatusChip status={cardStatus(inst, power)} />
        </Stack>

        {chips.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1.5 }}>
            {chips.map((c) => (
              <Chip key={String(c)} label={String(c)} size="small" variant="outlined" sx={{ color: 'text.secondary', maxWidth: '100%' }} />
            ))}
          </Box>
        )}

        <Stack spacing={0.25} sx={{ mb: 1.25 }}>
          <IpRow label="IPv4" value={inst.ipv4} />
          <IpRow label="IPv6" value={inst.ipv6} />
        </Stack>

        <Stack spacing={0.5}>
          <Typography variant="body2" component="div" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
            <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>到期</Box>
            {fmtDate(inst.expires)}
            {inst.expires && <Countdown to={inst.expires} />}
          </Typography>
          {inst.created && (
            <Typography variant="body2">
              <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>创建</Box>
              {fmtDate(inst.created)}
            </Typography>
          )}
        </Stack>
      </CardContent>

      <Divider />
      <CardActions sx={{ px: 1.5, py: 1, gap: 0.5, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<PlayArrowIcon />} disabled={disabled} onClick={() => run('boot')}>开机</Button>
        <Button size="small" startIcon={<PowerSettingsNewIcon />} disabled={disabled} onClick={() => run('shutdown')}>关机</Button>
        <Button size="small" startIcon={<RestartAltIcon />} disabled={disabled} onClick={() => run('restart')}>重启</Button>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="删除实例">
          <span>
            <IconButton size="small" color="error" aria-label="删除实例" disabled={disabled} onClick={() => run('destroy')}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="更多操作">
          <span>
            <IconButton size="small" aria-label="更多操作" disabled={disabled} onClick={(e) => setAnchor(e.currentTarget)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </CardActions>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {MENU.map((m) => (
          <MenuItem key={m.action} onClick={() => run(m.action)}>
            <ListItemIcon>{m.icon}</ListItemIcon>
            <ListItemText>{m.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </Card>
  );
}
