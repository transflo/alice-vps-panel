import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import { api } from '../api.js';
import { BootScriptField, DurationField, FormDialog, SelectField } from '../components.jsx';
import { getImages, getPermissions, getPlans, getSshKeys } from '../data.js';
import { useNotify } from '../notify.jsx';
import { durationOptions, maxHours, planOptions } from '../utils.js';

// 账户里没有 SSH 密钥时 Alice 返回 400 Failed 而不是空列表，所以读取失败只作为提示，不当成错误。
export function useSshKeyOptions() {
  const [state, setState] = useState({ keys: null, note: undefined });
  useEffect(() => {
    let alive = true;
    getSshKeys()
      .then((k) => alive && setState({ keys: k.map((x) => ({ id: x.id, label: x.name })), note: k.length ? undefined : '账户里还没有 SSH 密钥' }))
      .catch(() => alive && setState({ keys: [], note: '未读取到 SSH 密钥，可能还没有添加' }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

// 按套餐加载可用的系统镜像。
export function useImageOptions(planId, setError) {
  const [state, setState] = useState({ loading: false, options: [] });
  useEffect(() => {
    if (!planId) {
      setState({ loading: false, options: [] });
      return undefined;
    }
    let alive = true;
    setState({ loading: true, options: [] });
    getImages(planId)
      .then((list) => alive && setState({ loading: false, options: list.map((o) => ({ id: o.id, label: o.name, group: o.group })) }))
      .catch((e) => {
        if (!alive) return;
        setState({ loading: false, options: [] });
        setError(`系统列表加载失败：${e.message}`);
      });
    return () => {
      alive = false;
    };
  }, [planId, setError]);
  return state;
}

export function useMaxHours() {
  const [max, setMax] = useState(null);
  useEffect(() => {
    let alive = true;
    getPermissions().then((p) => alive && setMax(maxHours(p)));
    return () => {
      alive = false;
    };
  }, []);
  return max;
}

// 时长超过账户上限时自动调到允许的最大值。
export function useClampedHours(initial, max) {
  const [time, setTime] = useState(initial);
  useEffect(() => {
    if (!max) return;
    const allowed = durationOptions(max);
    setTime((t) => (allowed.includes(Number(t)) ? t : String(allowed[allowed.length - 1])));
  }, [max]);
  return [time, setTime];
}

export default function DeployDialog({ open, onClose, onExited, onDeployed }) {
  const notify = useNotify();
  const [loadError, setLoadError] = useState('');
  const [plans, setPlans] = useState(null);
  const [planId, setPlanId] = useState('');
  const [osId, setOsId] = useState('');
  const [keyId, setKeyId] = useState('');
  const [script, setScript] = useState('');
  const max = useMaxHours();
  const [time, setTime] = useClampedHours('24', max);
  const keys = useSshKeyOptions();
  const images = useImageOptions(planId, setLoadError);

  useEffect(() => {
    let alive = true;
    Promise.all([getPlans(), getPermissions()])
      .then(([list, perm]) => {
        if (!alive) return;
        const options = planOptions(list, perm);
        setPlans(options);
        const usable = options.filter((o) => !o.disabled);
        if (usable.length === 1) setPlanId(usable[0].id);
      })
      .catch((e) => {
        if (!alive) return;
        setPlans([]);
        setLoadError(`套餐加载失败：${e.message}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => setOsId(''), [planId]);

  const submit = async () => {
    const r = await api('POST', '/api/instances', {
      plan_id: planId,
      os_id: osId,
      time: Number(time),
      ssh_key_id: keyId || null,
      boot_script: script || undefined,
    });
    notify('实例创建请求已提交', 'success');
    onDeployed(r.data, Boolean(script));
  };

  return (
    <FormDialog open={open} onClose={onClose} onExited={onExited} title="新建实例" submitText="创建实例" onSubmit={submit}>
      {loadError && <Alert severity="warning">{loadError}</Alert>}
      <SelectField label="套餐" value={planId} onChange={setPlanId} options={plans || []} loading={plans === null} required />
      <SelectField
        label="系统"
        value={osId}
        onChange={setOsId}
        options={images.options}
        loading={images.loading}
        disabled={!planId}
        helperText={planId ? undefined : '请先选择套餐'}
        required
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <DurationField value={time} onChange={setTime} max={max} />
        <SelectField label="SSH 密钥" value={keyId} onChange={setKeyId} options={keys.keys || []} loading={keys.keys === null} emptyLabel="不使用（使用密码登录）" helperText={keys.note} />
      </Stack>
      <BootScriptField value={script} onChange={setScript} />
    </FormDialog>
  );
}
