// 各个弹窗共用的小组件。
import { useState } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { monoFont } from './theme.js';
import { durationLabel, durationOptions } from './utils.js';

// ---------- 弹窗外壳 ----------

function TitleBar({ children, onClose }) {
  return (
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}>
      <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </Box>
      {onClose && (
        <IconButton aria-label="关闭" onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </DialogTitle>
  );
}

// 普通弹窗。open / onClose / onExited 由 Dashboard 的弹窗栈传入。
export function SimpleDialog({ open, onClose, onExited, title, children, actions, maxWidth = 'sm' }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} slotProps={{ transition: { onExited } }}>
      <TitleBar onClose={onClose}>{title}</TitleBar>
      <DialogContent dividers>
        <Stack spacing={2}>{children}</Stack>
      </DialogContent>
      {actions && <DialogActions sx={{ px: 3, py: 1.5 }}>{actions}</DialogActions>}
    </Dialog>
  );
}

// 表单弹窗：onSubmit 抛错时把错误显示在弹窗里，成功后由调用方关闭。
export function FormDialog({ open, onClose, onExited, title, submitText, danger = false, onSubmit, children, maxWidth = 'sm', notice }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onSubmit();
    } catch (ex) {
      setError(ex.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth={maxWidth}
      slotProps={{ transition: { onExited }, paper: { component: 'form', onSubmit: handleSubmit, noValidate: false } }}
    >
      <TitleBar onClose={submitting ? undefined : onClose}>{title}</TitleBar>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          {notice}
          {children}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={submitting} color="inherit">取消</Button>
        <Button type="submit" variant="contained" color={danger ? 'error' : 'primary'} loading={submitting}>
          {submitText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------- 表单字段 ----------

// options: [{ id, label, disabled, group }]；emptyLabel 不为空时提供一个值为 '' 的选项。
export function SelectField({ label, value, onChange, options, loading = false, emptyLabel, required = false, helperText, disabled = false }) {
  const items = [];
  if (emptyLabel) items.push(<MenuItem key="__empty" value="">{emptyLabel}</MenuItem>);
  if (loading) {
    items.push(<MenuItem key="__loading" value="__loading" disabled>加载中…</MenuItem>);
  } else if (!options.length && !emptyLabel) {
    items.push(<MenuItem key="__none" value="__none" disabled>没有可选项</MenuItem>);
  }
  let group = null;
  for (const o of options) {
    if (o.group && o.group !== group) {
      group = o.group;
      items.push(<ListSubheader key={`g:${group}`}>{group}</ListSubheader>);
    }
    items.push(
      <MenuItem key={o.id} value={o.id} disabled={o.disabled}>
        {o.label || o.name}
      </MenuItem>,
    );
  }
  const known = value === '' || options.some((o) => o.id === value);
  return (
    <TextField
      select
      label={label}
      value={known ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      helperText={helperText}
      slotProps={{
        select: { displayEmpty: Boolean(emptyLabel), MenuProps: { slotProps: { paper: { sx: { maxHeight: 360 } } } } },
        inputLabel: emptyLabel ? { shrink: true } : undefined,
      }}
    >
      {items}
    </TextField>
  );
}

export function DurationField({ label = '使用时长', value, onChange, max }) {
  const options = durationOptions(max).map((n) => ({ id: String(n), label: durationLabel(n) }));
  return (
    <SelectField
      label={label}
      value={value}
      onChange={onChange}
      options={options}
      required
      helperText={max ? `你的账户单次最长 ${max} 小时` : undefined}
    />
  );
}

export function BootScriptField({ value, onChange }) {
  return (
    <TextField
      label="启动脚本（可选）"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      multiline
      minRows={4}
      placeholder={'#!/bin/bash\napt-get update -y'}
      helperText="实例启动后执行，面板会自动做 Base64 编码。"
      slotProps={{ htmlInput: { spellCheck: false } }}
      sx={{ '& textarea': { fontFamily: monoFont, fontSize: 13, lineHeight: 1.6 } }}
    />
  );
}

// ---------- 数据展示 ----------

export function Terminal({ children, sx }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        borderRadius: 1,
        bgcolor: '#0d1117',
        color: '#d7dde8',
        fontFamily: monoFont,
        fontSize: 13,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        maxHeight: 380,
        overflow: 'auto',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export function KvTable({ data }) {
  if (data === null || data === undefined) {
    return <Typography variant="body2" color="text.secondary">无数据</Typography>;
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return <Terminal>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</Terminal>;
  }
  const entries = Object.entries(data);
  if (!entries.length) return <Typography variant="body2" color="text.secondary">无数据</Typography>;
  return (
    <Table size="small" sx={{ '& td': { verticalAlign: 'top', wordBreak: 'break-all' } }}>
      <TableBody>
        {entries.map(([k, v]) => (
          <TableRow key={k} sx={{ '&:last-child td': { borderBottom: 0 } }}>
            <TableCell sx={{ color: 'text.secondary', width: '32%', pl: 0 }}>{k}</TableCell>
            <TableCell sx={{ pr: 0 }}>
              {v !== null && typeof v === 'object' ? (
                <Box component="pre" sx={{ m: 0, fontFamily: monoFont, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(v, null, 2)}
                </Box>
              ) : v === null || v === '' ? '—' : String(v)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function SectionTitle({ children }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5, display: 'block' }}>
      {children}
    </Typography>
  );
}
