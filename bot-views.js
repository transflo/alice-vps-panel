'use strict';

// bot 的纯渲染函数：HTML 转义、时间格式、实例卡片、键盘。不碰网络。

const { statusLabel, cardStatus } = require('./normalize');

const MAX_TEXT = 4096;
const CALLBACK_MAX_BYTES = 64;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 'YYYY-MM-DD HH:mm'，按指定时区（IANA 名称）显示。
function fmtTime(ms, tz) {
  return new Date(ms).toLocaleString('sv-SE', { timeZone: tz, hourCycle: 'h23' }).slice(0, 16);
}

// 与网页 fmtRemaining 一致的中文剩余时间。
function fmtRemaining(ms) {
  if (ms <= 0) return '已到期';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  if (d > 0) return `剩余 ${d} 天 ${hh} 小时`;
  if (hh > 0) return `剩余 ${hh} 小时 ${mm} 分`;
  return `剩余 ${mm} 分`;
}

// 保留末尾 max 个字符，用于命令输出。
function tail(text, max) {
  const t = String(text);
  return t.length <= max ? { text: t, truncated: false } : { text: t.slice(t.length - max), truncated: true };
}

// callback_data 不能超过 64 字节；超长的按钮直接不生成（实例 ID 允许最长 64 个字符，实际是几位数字）。
function btn(text, data) {
  return Buffer.byteLength(data) <= CALLBACK_MAX_BYTES ? { text, callback_data: data } : null;
}

const rows = (...list) => list.map((r) => r.filter(Boolean)).filter((r) => r.length);

// 返回 { text, keyboard }：文字用 HTML，动态内容全部转义。
function instanceCard({ inst, power, auto, tz, now }) {
  const lines = [`<b>${esc(inst.name || `实例 #${inst.id}`)}</b>  <code>#${esc(inst.id)}</code>`];
  lines.push(`状态：${esc(statusLabel(cardStatus(inst, power)))}`);
  const spec = [inst.plan ? `套餐：${esc(inst.plan)}` : null, inst.os ? `系统：${esc(inst.os)}` : null].filter(Boolean);
  if (spec.length) lines.push(spec.join(' · '));
  if (inst.ipv4) lines.push(`IPv4：<code>${esc(inst.ipv4)}</code>`);
  if (inst.ipv6) lines.push(`IPv6：<code>${esc(inst.ipv6)}</code>`);
  lines.push(inst.expiresAt
    ? `到期：${fmtTime(inst.expiresAt, tz)}（${fmtRemaining(inst.expiresAt - now)}）`
    : '到期：—');
  lines.push(auto && auto.enabled ? `自动续期：开（每次 ${auto.hours} 小时）` : '自动续期：关');

  const id = inst.id;
  return {
    text: lines.join('\n'),
    keyboard: rows(
      [btn('开机', `p:boot:${id}`), btn('关机', `p:shutdown:${id}`), btn('重启', `p:restart:${id}`)],
      [btn('强制关机', `p:poweroff:${id}`), btn('续期', `rn:${id}`), btn('自动续期', `ar:${id}`)],
      [btn('重装', `rb:${id}`), btn('执行命令', `ex:${id}`), btn('删除', `dx:${id}`)],
      [btn('刷新', `i:${id}`)],
    ),
  };
}

const hoursLabel = (h) => (h % 24 === 0 ? `${h / 24} 天` : `${h} 小时`);

// 时长选择键盘：每行 3 个，callback_data = `${prefix}:${h}`；backData 不为空时最后一行是"返回"。
function hoursKeyboard(prefix, options, backData) {
  const buttons = options.map((h) => btn(hoursLabel(h), `${prefix}:${h}`));
  const grid = [];
  for (let i = 0; i < buttons.length; i += 3) grid.push(buttons.slice(i, i + 3));
  if (backData) grid.push([btn('返回', backData)]);
  return rows(...grid);
}

module.exports = { MAX_TEXT, esc, btn, rows, fmtTime, fmtRemaining, tail, instanceCard, hoursKeyboard };
