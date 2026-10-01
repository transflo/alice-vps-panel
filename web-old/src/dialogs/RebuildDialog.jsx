import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import { api, enc } from '../api.js';
import { BootScriptField, FormDialog, SelectField } from '../components.jsx';
import { getPlans } from '../data.js';
import { useNotify } from '../notify.jsx';
import { useImageOptions, useSshKeyOptions } from './DeployDialog.jsx';

export default function RebuildDialog({ open, onClose, onExited, inst, withBusy, onRebuilt }) {
  const notify = useNotify();
  const [loadError, setLoadError] = useState('');
  // 系统镜像按套餐获取；实例数据里没有套餐 ID 时让用户自己选。
  const knownPlan = inst.planId !== undefined ? String(inst.planId) : '';
  const [plans, setPlans] = useState(null);
  const [planId, setPlanId] = useState(knownPlan);
  const [osId, setOsId] = useState('');
  const [keyId, setKeyId] = useState('');
  const [script, setScript] = useState('');
  const keys = useSshKeyOptions();
  const images = useImageOptions(planId, setLoadError);

  useEffect(() => {
    if (knownPlan) return undefined;
    let alive = true;
    getPlans()
      .then((list) => alive && setPlans(list.map((p) => ({ id: p.id, label: p.name }))))
      .catch((e) => {
        if (!alive) return;
        setPlans([]);
        setLoadError(`套餐加载失败：${e.message}`);
      });
    return () => {
      alive = false;
    };
  }, [knownPlan]);

  useEffect(() => setOsId(''), [planId]);

  const submit = async () => {
    const r = await withBusy(inst, () => api('POST', `/api/instances/${enc(inst.id)}/rebuild`, {
      os_id: osId,
      ssh_key_id: keyId || null,
      boot_script: script || undefined,
    }));
    notify('重装请求已提交', 'success');
    onRebuilt(r.data, Boolean(script));
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={`重装系统 · ${inst.name || `#${inst.id}`}`}
      submitText="确认重装"
      danger
      onSubmit={submit}
      notice={<Alert severity="warning">重装会清空这台实例上的全部数据，且无法恢复。</Alert>}
    >
      {loadError && <Alert severity="warning">{loadError}</Alert>}
      {!knownPlan && (
        <SelectField
          label="套餐"
          value={planId}
          onChange={setPlanId}
          options={plans || []}
          loading={plans === null}
          helperText="用于加载该套餐可用的系统镜像"
          required
        />
      )}
      <SelectField label="系统" value={osId} onChange={setOsId} options={images.options} loading={images.loading} disabled={!planId} required />
      <SelectField label="SSH 密钥" value={keyId} onChange={setKeyId} options={keys.keys || []} loading={keys.keys === null} emptyLabel="不使用（使用密码登录）" helperText={keys.note} />
      <BootScriptField value={script} onChange={setScript} />
    </FormDialog>
  );
}
