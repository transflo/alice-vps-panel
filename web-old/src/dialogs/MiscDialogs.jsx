import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, enc } from '../api.js';
import { DurationField, FormDialog, KvTable, SectionTitle, SimpleDialog } from '../components.jsx';
import { getOverview } from '../data.js';
import { useNotify } from '../notify.jsx';
import { copyText, fmtCredit, fmtDate, pick, stateSummary, toDate } from '../utils.js';
import { useClampedHours, useMaxHours } from './DeployDialog.jsx';

export function ConfirmDialog({ open, onClose, onExited, title, message, confirmText = '确定', danger = false, onConfirm }) {
  return (
    <SimpleDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={title}
      maxWidth="xs"
      actions={
        <>
          <Button onClick={onClose} color="inherit">取消</Button>
          <Button
            variant="contained"
            color={danger ? 'error' : 'primary'}
            autoFocus
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <Typography>{message}</Typography>
    </SimpleDialog>
  );
}

export function RenewDialog({ open, onClose, onExited, inst, withBusy, onRenewed }) {
  const notify = useNotify();
  const max = useMaxHours();
  const [time, setTime] = useClampedHours('24', max);

  const submit = async () => {
    const r = await withBusy(inst, () => api('POST', `/api/instances/${enc(inst.id)}/renewals`, { time: Number(time) }));
    const next = toDate(pick(r.data, 'expiration_at_utc', 'expiration_at'));
    notify(next ? `续期成功，新的到期时间 ${fmtDate(next)}` : '续期成功', 'success');
    onRenewed();
  };

  return (
    <FormDialog open={open} onClose={onClose} onExited={onExited} title={`续期 · ${inst.name || `#${inst.id}`}`} submitText="续期" maxWidth="xs" onSubmit={submit}>
      <Typography variant="body2" color="text.secondary">当前到期时间：{fmtDate(inst.expires)}</Typography>
      <DurationField label="续期时长" value={time} onChange={setTime} max={max} />
    </FormDialog>
  );
}

export function DestroyDialog({ open, onClose, onExited, inst, withBusy, onDestroyed }) {
  const notify = useNotify();
  const [confirm, setConfirm] = useState('');

  const submit = async () => {
    if (confirm.trim() !== inst.id) throw new Error('输入的实例 ID 不匹配');
    await withBusy(inst, () => api('DELETE', `/api/instances/${enc(inst.id)}`));
    notify('实例已删除', 'success');
    onDestroyed();
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title="删除实例"
      submitText="永久删除"
      danger
      maxWidth="xs"
      onSubmit={submit}
      notice={<Alert severity="error">将永久销毁「{inst.name || inst.id}」及其全部数据，无法恢复。</Alert>}
    >
      <TextField
        label={`输入实例 ID「${inst.id}」确认`}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="off"
        placeholder={inst.id}
        required
        autoFocus
      />
    </FormDialog>
  );
}

// 常用字段排在前面，方便一眼看到登录信息。
const RESULT_FIRST = ['hostname', 'ipv4', 'ipv6', 'password', 'sshkey', 'id', 'expiration_at'];

export function ResultDialog({ open, onClose, onExited, title, note, data, onShowBootScript }) {
  const notify = useNotify();
  let shown = data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    shown = {};
    for (const k of RESULT_FIRST) if (k in data) shown[k] = data[k];
    Object.assign(shown, data);
  }
  const copyAll = async () => {
    const ok = await copyText(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    notify(ok ? '已复制' : '复制失败，请手动复制', ok ? 'success' : 'error');
  };
  return (
    <SimpleDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={title}
      maxWidth="md"
      actions={
        <>
          {onShowBootScript && <Button onClick={onShowBootScript}>查看启动脚本输出</Button>}
          <Button onClick={copyAll}>复制全部</Button>
          <Button variant="contained" onClick={onClose}>完成</Button>
        </>
      }
    >
      {note && <Alert severity="info">{note}</Alert>}
      <KvTable data={shown} />
    </SimpleDialog>
  );
}

function Loading() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: 'text.secondary' }}>
      <CircularProgress size={18} />
      <Typography variant="body2">加载中…</Typography>
    </Box>
  );
}

export function DetailsDialog({ open, onClose, onExited, inst }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  useEffect(() => {
    let alive = true;
    api('GET', `/api/instances/${enc(inst.id)}/state`)
      .then((r) => alive && setState({ loading: false, data: r.data, error: '' }))
      .catch((e) => alive && setState({ loading: false, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [inst.id]);

  const summary = stateSummary(state.data);

  return (
    <SimpleDialog open={open} onClose={onClose} onExited={onExited} title={`实例详情 · ${inst.name || `#${inst.id}`}`} maxWidth="md">
      {summary && (
        <div>
          <SectionTitle>运行情况</SectionTitle>
          <KvTable data={summary} />
        </div>
      )}
      <div>
        <SectionTitle>实时状态</SectionTitle>
        {state.loading ? <Loading /> : state.error ? <Alert severity="error">获取失败：{state.error}</Alert> : <KvTable data={state.data} />}
      </div>
      <div>
        <SectionTitle>实例数据</SectionTitle>
        <KvTable data={inst.raw} />
      </div>
    </SimpleDialog>
  );
}

export function AccountDialog({ open, onClose, onExited }) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  useEffect(() => {
    let alive = true;
    getOverview({ force: true })
      .then((data) => alive && setState({ loading: false, data, error: '' }))
      .catch((e) => alive && setState({ loading: false, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, []);

  const part = (title, s) => (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {s && s.ok ? <KvTable data={s.data} /> : <Alert severity="error">获取失败：{s ? s.error : '无数据'}</Alert>}
    </div>
  );

  // 余额按美元显示，括号里保留 Alice 返回的原始值。
  const profile = state.data && state.data.profile;
  const shownProfile = profile && profile.ok && profile.data && profile.data.credit !== undefined
    ? { ...profile, data: { ...profile.data, credit: `${fmtCredit(profile.data.credit)}（${profile.data.credit}）` } }
    : profile;

  return (
    <SimpleDialog open={open} onClose={onClose} onExited={onExited} title="账户信息" maxWidth="md">
      {state.loading && <Loading />}
      {state.error && <Alert severity="error">{state.error}</Alert>}
      {state.data && part('账户', shownProfile)}
      {state.data && part('EVO 权限', state.data.permissions)}
    </SimpleDialog>
  );
}
