import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { api, enc } from '../api.js';
import { SimpleDialog, Terminal } from '../components.jsx';
import { monoFont } from '../theme.js';
import { decodeOutput, firstValue, pick, RUNNING_RE } from '../utils.js';

const IDLE = { phase: 'idle', status: '', output: '', error: '' };
const TIMEOUT_MS = 5 * 60 * 1000;

// 轮询命令执行结果（最长 5 分钟）。
function useCommandWatcher() {
  const [state, setState] = useState(IDLE);
  const timer = useRef(null);
  const token = useRef(0);

  const stop = useCallback(() => {
    token.current += 1;
    clearTimeout(timer.current);
  }, []);

  useEffect(() => stop, [stop]);

  const watch = useCallback((instId, uid) => {
    stop();
    const mine = token.current;
    const started = Date.now();
    setState({ phase: 'running', status: '已提交，等待结果…', output: '', error: '' });

    const poll = async () => {
      try {
        const r = await api('GET', `/api/instances/${enc(instId)}/exec/${enc(uid)}`);
        if (mine !== token.current) return;
        const d = r.data && typeof r.data === 'object' ? r.data : {};
        const out = firstValue(d, 'output');
        const result = firstValue(d, 'result');
        let text = out !== undefined ? decodeOutput(out) : '';
        if (!text && typeof result === 'string' && result.length > 60) text = decodeOutput(result);
        const st = String(firstValue(d, 'status') ?? '');
        const running = RUNNING_RE.test(st) || (!st && !text);

        if (running && Date.now() - started < TIMEOUT_MS) {
          setState({ phase: 'running', status: `执行中${st ? `（${st}）` : ''}…`, output: text, error: '' });
          timer.current = setTimeout(poll, 2000);
          return;
        }
        let status;
        if (running) {
          status = `5 分钟内仍未完成（${st || '无状态'}），可以稍后重新查询。`;
        } else {
          const resText = result === undefined ? '' : typeof result === 'object' ? JSON.stringify(result) : String(result);
          status = `执行结束：${st || '完成'}${resText && resText.length <= 60 ? `，结果：${resText}` : ''}`;
        }
        setState({ phase: 'done', status, output: text, error: '' });
      } catch (e) {
        if (mine !== token.current) return;
        setState({ phase: 'done', status: '', output: '', error: `查询结果失败：${e.message}` });
      }
    };
    timer.current = setTimeout(poll, 1500);
  }, [stop]);

  return { ...state, watch, stop, setState };
}

function CommandResult({ watcher }) {
  return (
    <>
      {watcher.status && <Typography variant="body2" color="text.secondary">{watcher.status}</Typography>}
      {watcher.error && <Alert severity="error">{watcher.error}</Alert>}
      {watcher.output && <Terminal>{watcher.output}</Terminal>}
    </>
  );
}

export function ExecDialog({ open, onClose, onExited, inst }) {
  const [command, setCommand] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const watcher = useCommandWatcher();

  const run = async (e) => {
    e.preventDefault();
    if (!command.trim() || submitting || watcher.phase === 'running') return;
    setSubmitting(true);
    watcher.setState({ phase: 'running', status: '正在提交…', output: '', error: '' });
    try {
      const r = await api('POST', `/api/instances/${enc(inst.id)}/exec`, { command });
      const uid = typeof r.data === 'string' ? r.data : pick(r.data, 'command_uid', 'uid');
      if (uid) watcher.watch(inst.id, String(uid));
      else watcher.setState({ phase: 'done', status: '已提交，但 Alice 没有返回 command_uid，无法查询结果。', output: '', error: '' });
    } catch (ex) {
      watcher.setState({ phase: 'done', status: '', output: '', error: ex.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SimpleDialog open={open} onClose={onClose} onExited={onExited} title={`执行命令 · ${inst.name || `#${inst.id}`}`} maxWidth="md">
      <Stack component="form" onSubmit={run} spacing={1.5}>
        <TextField
          label="命令"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          multiline
          minRows={3}
          placeholder="uptime && df -h"
          helperText="以 root 身份在实例上异步执行，面板会自动做 Base64 编码。按 Ctrl + Enter 执行。"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(e);
          }}
          autoFocus
          required
          slotProps={{ htmlInput: { spellCheck: false } }}
          sx={{ '& textarea': { fontFamily: monoFont, fontSize: 13, lineHeight: 1.6 } }}
        />
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button type="submit" variant="contained" loading={submitting || watcher.phase === 'running'}>执行</Button>
        </Stack>
      </Stack>
      <CommandResult watcher={watcher} />
    </SimpleDialog>
  );
}

// 查看某个命令（比如启动脚本）的执行输出。
export function CommandOutputDialog({ open, onClose, onExited, instId, uid, title = '命令输出' }) {
  const watcher = useCommandWatcher();
  const { watch } = watcher;

  useEffect(() => {
    watch(instId, uid);
  }, [watch, instId, uid]);

  return (
    <SimpleDialog
      open={open}
      onClose={onClose}
      onExited={onExited}
      title={title}
      maxWidth="md"
      actions={<Button onClick={() => watch(instId, uid)} disabled={watcher.phase === 'running'}>重新查询</Button>}
    >
      <Typography variant="caption" color="text.secondary">实例 #{instId} · 命令 {uid}</Typography>
      <CommandResult watcher={watcher} />
    </SimpleDialog>
  );
}
