'use strict';

// Alice 返回的时间在这里统一规范化成 ISO 8601 UTC 字符串（设计文档 §1）。
// 已知：creation_at 的偏移标签是错的（钟面数字是 Alice 服务器本地时间 UTC+8，标签却写成 +01:00），
// 所以忽略标签、按 clockOffset 解释钟面；expiration_at 的数字和标签自洽，按标签解析。
// 不带标签的时间目前没有真实数据印证，沿用原来的约定：到期时间按 UTC。

const DEFAULT_CLOCK_OFFSET = '+08:00';
const CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

// 'Z' / '+08:00' / '-0530' → 分钟数；无法识别返回 null。
function offsetMinutes(text) {
  const s = String(text).trim();
  if (/^z$/i.test(s)) return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(s);
  if (!m || Number(m[2]) > 14 || Number(m[3]) > 59) return null;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

function parseAliceTime(value, { ignoreOffset = false, clockOffset = DEFAULT_CLOCK_OFFSET } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    const n = Number(value);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value !== 'string') return null;
  const m = CLOCK_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '0', label] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +h > 23 || +mi > 59 || +s > 59) return null;
  // Date.UTC 会把 2 月 30 日这类日期顺延到下个月，这里要拒绝。
  if (new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDate() !== +d) return null;
  let offset;
  if (ignoreOffset) offset = offsetMinutes(clockOffset);
  else if (!label) offset = 0;
  else offset = offsetMinutes(label);
  if (offset === null) return null;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Math.round(Number(`0.${frac}`) * 1000)) - offset * 60000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// 环境变量 ALICE_CLOCK_OFFSET 的校验：非法值回退到默认并给出警告。
function parseClockOffset(text, warn = console.warn) {
  if (text === undefined || text === null || String(text).trim() === '') return DEFAULT_CLOCK_OFFSET;
  const s = String(text).trim();
  if (/^[+-]\d{2}:?\d{2}$/.test(s) && offsetMinutes(s) !== null) return s;
  warn(`ALICE_CLOCK_OFFSET=${s} 不是合法的偏移（应形如 +08:00），已使用默认值 ${DEFAULT_CLOCK_OFFSET}`);
  return DEFAULT_CLOCK_OFFSET;
}

// 返回浅拷贝：原始字段原样保留，解析成功时追加 creation_at_utc / expiration_at_utc。
function withUtcTimes(record, clockOffset = DEFAULT_CLOCK_OFFSET) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
  const out = { ...record };
  const created = parseAliceTime(record.creation_at, { ignoreOffset: true, clockOffset });
  const expires = parseAliceTime(record.expiration_at);
  if (created) out.creation_at_utc = created;
  if (expires) out.expiration_at_utc = expires;
  return out;
}

module.exports = { DEFAULT_CLOCK_OFFSET, parseAliceTime, parseClockOffset, withUtcTimes };
