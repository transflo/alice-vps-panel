import { useState } from 'react';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { api, enc } from '../api.js';
import { DurationField, FormDialog } from '../components.jsx';
import { useNotify } from '../notify.jsx';
import { useClampedHours, useMaxHours } from './DeployDialog.jsx';

export default function AutoRenewDialog({ open, onClose, onExited, inst, state, withBusy, onChanged }) {
  const notify = useNotify();
  const max = useMaxHours();
  const current = state.items[inst.id];
  const [enabled, setEnabled] = useState(Boolean(current && current.enabled));
  const [time, setTime] = useClampedHours(String((current && current.hours) || 24), max);

  const submit = async () => {
    await withBusy(inst, () => api('POST', `/api/instances/${enc(inst.id)}/auto-renew`, enabled ? { enabled: true, hours: Number(time) } : { enabled: false }));
    notify(enabled ? `已开启自动续期：到期前自动续 ${time} 小时` : '已关闭自动续期', 'success');
    onChanged();
  };

  return (
    <FormDialog open={open} onClose={onClose} onExited={onExited} title={`自动续期 · ${inst.name || `#${inst.id}`}`} submitText="保存" maxWidth="xs" onSubmit={submit}>
      {!state.available && (
        <Alert severity="warning">服务器没有可写的数据目录（DATA_DIR），暂时无法保存自动续期设置。请按 README 挂载数据卷后重试。</Alert>
      )}
      <Typography variant="body2" color="text.secondary">
        开启后，面板会在实例到期前约 10 分钟自动续期，不需要保持页面打开。每次续期会扣费，余额不足时续期会失败。
      </Typography>
      <FormControlLabel control={<Switch checked={enabled} disabled={!state.available} onChange={(e) => setEnabled(e.target.checked)} />} label="启用自动续期" />
      {enabled && <DurationField label="每次续期时长" value={time} onChange={setTime} max={max} />}
    </FormDialog>
  );
}
