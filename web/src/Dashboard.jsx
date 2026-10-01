import { useCallback, useEffect, useRef, useState } from 'react';
import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import AddIcon from '@mui/icons-material/Add';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import RefreshIcon from '@mui/icons-material/Refresh';
import Alert from '@mui/material/Alert';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { api, enc } from './api.js';
import { getOverview } from './data.js';
import InstanceCard from './InstanceCard.jsx';
import Logo from './Logo.jsx';
import { useNotify } from './notify.jsx';
import { asList, fmtCredit, fmtDate, normInstance, pick, powerState } from './utils.js';
import DeployDialog from './dialogs/DeployDialog.jsx';
import RebuildDialog from './dialogs/RebuildDialog.jsx';
import { CommandOutputDialog, ExecDialog } from './dialogs/CommandDialogs.jsx';
import { AccountDialog, ConfirmDialog, DestroyDialog, DetailsDialog, RenewDialog, ResultDialog } from './dialogs/MiscDialogs.jsx';

const POWER_TEXT = { boot: '开机', shutdown: '关机', restart: '重启', poweroff: '强制关机' };
const REFRESH_MS = 30000;
const GRID_SX = { display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))' };

// 部署 / 重装接口有返回内容时（比如 root 密码）才弹出结果窗口。
const hasResult = (data) => data !== null && data !== undefined && data !== true && data !== '';

export default function Dashboard({ configured, onLogout }) {
  const notify = useNotify();
  const [instances, setInstances] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [busy, setBusy] = useState({});
  const [powerStates, setPowerStates] = useState({});
  const [account, setAccount] = useState({ name: '', balance: undefined });
  const [dialogs, setDialogs] = useState([]);

  const mounted = useRef(true);
  const inFlight = useRef(false);
  const lastLoad = useRef(0);
  const timers = useRef(new Set());
  const dialogSeq = useRef(0);
  const powerSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    return () => {
      mounted.current = false;
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // ---------- 数据 ----------

  // 实例列表只说明实例是否有效，开关机状态要逐台查询状态接口；查不到时卡片显示列表里的状态。
  const loadPower = useCallback(async (list) => {
    const seq = ++powerSeq.current;
    const targets = list.filter((i) => i.id && !/expire/i.test(String(i.status ?? '')));
    const results = await Promise.all(targets.map(async (i) => {
      try {
        return [i.id, powerState((await api('GET', `/api/instances/${enc(i.id)}/state`)).data)];
      } catch {
        return [i.id, undefined];
      }
    }));
    if (mounted.current && seq === powerSeq.current) setPowerStates(Object.fromEntries(results.filter(([, p]) => p)));
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await api('GET', '/api/instances');
      if (!mounted.current) return;
      const list = asList(r.data).map(normInstance);
      setInstances(list);
      loadPower(list);
      setError('');
      setUpdatedAt(new Date());
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      inFlight.current = false;
      lastLoad.current = Date.now();
      if (mounted.current) {
        setLoading(false);
        setLoaded(true);
      }
    }
  }, [loadPower]);

  // 操作提交后实例状态要过一会儿才变，稍后再刷新两次。
  const refreshSoon = useCallback(() => {
    for (const ms of [2500, 10000]) {
      const t = setTimeout(() => {
        timers.current.delete(t);
        load();
      }, ms);
      timers.current.add(t);
    }
  }, [load]);

  const loadAccount = useCallback((force = false) => {
    getOverview({ force })
      .then((o) => {
        if (!mounted.current) return;
        const p = o && o.profile && o.profile.ok ? o.profile.data : null;
        setAccount({ name: pick(p, 'email', 'username', 'fullname', 'name') || '', balance: pick(p, 'credit', 'balance') });
      })
      .catch(() => {
        /* 顶栏账户信息非必需 */
      });
  }, []);

  // 页面可见时每 30 秒自动刷新；切回页面时如果数据已经旧了也刷新一次。
  useEffect(() => {
    load();
    loadAccount();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > REFRESH_MS) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, loadAccount]);

  // 同一实例可能有多个操作同时进行，用计数避免先结束的操作提前清掉忙碌状态。
  const withBusy = useCallback(async (inst, fn) => {
    const id = inst.id;
    setBusy((b) => ({ ...b, [id]: (b[id] || 0) + 1 }));
    try {
      return await fn();
    } finally {
      if (mounted.current) {
        setBusy((b) => {
          const next = { ...b };
          if ((next[id] || 1) > 1) next[id] -= 1;
          else delete next[id];
          return next;
        });
      }
    }
  }, []);

  // ---------- 弹窗栈 ----------
  // 关闭时先把 open 设为 false，等退场动画结束（onExited）再移除。

  const openDialog = useCallback((type, props = {}) => {
    dialogSeq.current += 1;
    const key = dialogSeq.current;
    setDialogs((list) => [...list, { key, type, open: true, props }]);
  }, []);

  const closeDialog = useCallback((key) => {
    setDialogs((list) => list.map((d) => (d.key === key ? { ...d, open: false } : d)));
  }, []);

  const removeDialog = useCallback((key) => {
    setDialogs((list) => list.filter((d) => d.key !== key));
  }, []);

  const showResult = (title, data, note, instId, hadScript) => {
    const uid = pick(data, 'boot_script_uid');
    openDialog('result', {
      title,
      data,
      note,
      bootScript: hadScript && instId !== undefined && uid !== undefined ? { instId: String(instId), uid: String(uid) } : null,
    });
  };

  // ---------- 操作 ----------

  const power = async (inst, action) => {
    try {
      await withBusy(inst, () => api('POST', `/api/instances/${enc(inst.id)}/power`, { action }));
      notify(`已发送${POWER_TEXT[action]}指令`, 'success');
      refreshSoon();
    } catch (e) {
      notify(`${POWER_TEXT[action]}失败：${e.message}`, 'error');
    }
  };

  const onAction = (action, inst) => {
    const label = inst.name || inst.id;
    switch (action) {
      case 'boot':
        power(inst, action);
        break;
      case 'shutdown':
      case 'restart':
      case 'poweroff':
        openDialog('confirm', {
          title: `${POWER_TEXT[action]}实例`,
          message: action === 'poweroff'
            ? `确定强制关闭「${label}」吗？相当于直接断电，未保存的数据可能丢失。`
            : `确定${POWER_TEXT[action]}「${label}」吗？`,
          confirmText: POWER_TEXT[action],
          danger: action === 'poweroff',
          onConfirm: () => power(inst, action),
        });
        break;
      default:
        openDialog(action, { inst });
    }
  };

  const logout = async () => {
    try {
      await api('POST', '/api/logout');
    } catch {
      /* 忽略 */
    }
    onLogout();
  };

  const renderDialog = (d) => {
    const common = { open: d.open, onClose: () => closeDialog(d.key), onExited: () => removeDialog(d.key) };
    const { inst } = d.props;
    switch (d.type) {
      case 'confirm':
        return <ConfirmDialog key={d.key} {...common} {...d.props} />;
      case 'account':
        return <AccountDialog key={d.key} {...common} />;
      case 'deploy':
        return (
          <DeployDialog
            key={d.key}
            {...common}
            onDeployed={(data, hadScript) => {
              closeDialog(d.key);
              load();
              refreshSoon();
              loadAccount(true);
              if (hasResult(data)) {
                showResult('实例已创建', data, '请保存好下面的信息（如 root 密码），关闭后面板不会再次显示。',
                  pick(data, 'id', 'instance_id', 'server_id'), hadScript);
              }
            }}
          />
        );
      case 'rebuild':
        return (
          <RebuildDialog
            key={d.key}
            {...common}
            inst={inst}
            withBusy={withBusy}
            onRebuilt={(data, hadScript) => {
              closeDialog(d.key);
              refreshSoon();
              if (hasResult(data)) showResult('重装已提交', data, '请保存好下面的信息（如新的 root 密码）。', inst.id, hadScript);
            }}
          />
        );
      case 'renew':
        return (
          <RenewDialog
            key={d.key}
            {...common}
            inst={inst}
            withBusy={withBusy}
            onRenewed={() => {
              closeDialog(d.key);
              load();
              loadAccount(true);
            }}
          />
        );
      case 'destroy':
        return (
          <DestroyDialog
            key={d.key}
            {...common}
            inst={inst}
            withBusy={withBusy}
            onDestroyed={() => {
              closeDialog(d.key);
              setInstances((list) => list.filter((i) => i.id !== inst.id));
              refreshSoon();
              loadAccount(true);
            }}
          />
        );
      case 'exec':
        return <ExecDialog key={d.key} {...common} inst={inst} />;
      case 'details':
        return <DetailsDialog key={d.key} {...common} inst={inst} />;
      case 'result': {
        const { bootScript, ...rest } = d.props;
        return (
          <ResultDialog
            key={d.key}
            {...common}
            {...rest}
            onShowBootScript={bootScript ? () => openDialog('output', { ...bootScript, title: '启动脚本输出' }) : undefined}
          />
        );
      }
      case 'output':
        return <CommandOutputDialog key={d.key} {...common} {...d.props} />;
      default:
        return null;
    }
  };

  // ---------- 页面 ----------

  const openDeploy = () => openDialog('deploy');

  let content;
  if (!loaded) {
    content = (
      <Box sx={GRID_SX}>
        {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={268} />)}
      </Box>
    );
  } else if (instances.length) {
    content = (
      <Box sx={GRID_SX}>
        {instances.map((inst, i) => (
          <InstanceCard key={inst.id || `idx-${i}`} inst={inst} power={powerStates[inst.id]} busy={Boolean(busy[inst.id])} onAction={onAction} />
        ))}
      </Box>
    );
  } else if (!error) {
    content = (
      <Card sx={{ py: 7, px: 3, textAlign: 'center' }}>
        <DnsOutlinedIcon sx={{ fontSize: 44, color: 'text.disabled' }} />
        <Typography color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>还没有实例</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openDeploy}>创建第一个实例</Button>
      </Card>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Logo size={28} />
          <Typography component="div" sx={{ fontWeight: 700, fontSize: 17, ml: 0.5, display: { xs: 'none', sm: 'block' } }}>
            Alice 面板
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="账户信息">
            <Button
              color="inherit"
              startIcon={<AccountCircleOutlinedIcon />}
              onClick={() => openDialog('account')}
              sx={{ minWidth: 0, maxWidth: { xs: 180, sm: 380 }, fontWeight: 500 }}
            >
              {/* 手机上只显示余额，宽屏显示邮箱和余额 */}
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <Box component="span" sx={{ display: account.balance !== undefined ? { xs: 'none', sm: 'inline' } : 'inline' }}>
                  {account.name || '账户'}
                  {account.balance !== undefined && ' · '}
                </Box>
                {account.balance !== undefined && `余额 ${fmtCredit(account.balance)}`}
              </Box>
            </Button>
          </Tooltip>
          <Tooltip title="刷新">
            <span>
              <IconButton aria-label="刷新" onClick={() => load()} disabled={loading}>
                {loading ? <CircularProgress size={20} color="inherit" /> : <RefreshIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="退出登录">
            <IconButton aria-label="退出登录" onClick={logout} edge="end">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 2.5, sm: 4 } }}>
        <Stack spacing={2.5}>
          {!configured && (
            <Alert severity="warning">
              服务器未配置 ALICE_CLIENT_ID / ALICE_SECRET，面板暂时无法调用 Alice API。请在 .env 中填写后重启容器。
            </Alert>
          )}

          <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>实例</Typography>
                {loaded && !error && <Chip size="small" label={instances.length} aria-label={`共 ${instances.length} 台`} />}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {updatedAt ? `更新于 ${fmtDate(updatedAt, true)}` : ' '}
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openDeploy}>新建实例</Button>
          </Stack>

          {error && (
            <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => load()}>重试</Button>}>
              加载实例失败：{error}
            </Alert>
          )}

          {content}
        </Stack>
      </Container>

      {dialogs.map(renderDialog)}
    </Box>
  );
}
