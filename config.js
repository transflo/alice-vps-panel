'use strict';

// 环境变量解析与校验：非法值回退默认并警告，不让面板因为配置错误无法启动。

const path = require('node:path');

function intInRange(raw, name, def, min, max, warn) {
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  warn(`${name}=${raw} 无效（需为 ${min} ~ ${max} 的整数），已使用默认值 ${def}`);
  return def;
}

function timeZone(raw, def, warn) {
  if (raw === undefined || String(raw).trim() === '') return def;
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(raw).trim() });
    return String(raw).trim();
  } catch {
    warn(`DISPLAY_TIME_ZONE=${raw} 不是有效的 IANA 时区，已使用默认值 ${def}`);
    return def;
  }
}

// API 地址必须走 https（本地回环测试地址允许 http），且不能带账号口令，避免 token 明文传输或被劫持。
function apiBase(raw, def, name, warn) {
  const s = String(raw || '').trim() || def;
  try {
    const u = new URL(s);
    const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname);
    if (u.username || u.password) throw new Error('不能带账号口令');
    if (u.protocol === 'http:' && !loopback) throw new Error('必须以 https:// 开头');
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('协议不支持');
    return s.replace(/\/+$/, '');
  } catch (err) {
    warn(`${name}=${s} 无效（${err.message}），已使用默认值 ${def}`);
    return def;
  }
}

function loadConfig(env = process.env, warn = (msg) => console.warn(`[panel] ${msg}`)) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const rawIds = String(env.TELEGRAM_ALLOWED_USER_IDS || '').split(/[,\s]+/).filter(Boolean);
  const allowedIds = rawIds.filter((s) => /^\d{1,15}$/.test(s));
  for (const bad of rawIds.filter((s) => !allowedIds.includes(s))) {
    warn(`TELEGRAM_ALLOWED_USER_IDS 里的 "${bad}" 不是数字用户 ID，已忽略`);
  }

  const telegram = {
    enabled: false,
    token,
    allowedIds,
    apiBase: apiBase(env.TELEGRAM_API_BASE, 'https://api.telegram.org', 'TELEGRAM_API_BASE', warn),
  };
  // 失败默认关闭：没有有效的白名单就不启动 bot。
  if (token && allowedIds.length) telegram.enabled = true;
  else if (token) telegram.error = '设置了 TELEGRAM_BOT_TOKEN，但 TELEGRAM_ALLOWED_USER_IDS 没有有效的数字用户 ID，bot 不会启动';

  return {
    dataDir: env.DATA_DIR || path.join(__dirname, 'data'),
    renewBeforeMinutes: intInRange(env.AUTO_RENEW_BEFORE_MINUTES, 'AUTO_RENEW_BEFORE_MINUTES', 60, 1, 120, warn),
    renewRetryMinutes: intInRange(env.AUTO_RENEW_RETRY_MINUTES, 'AUTO_RENEW_RETRY_MINUTES', 10, 1, 60, warn),
    intervalSeconds: intInRange(env.AUTO_RENEW_INTERVAL_SECONDS, 'AUTO_RENEW_INTERVAL_SECONDS', 60, 1, 600, warn),
    displayTimeZone: timeZone(env.DISPLAY_TIME_ZONE, 'Asia/Shanghai', warn),
    telegram,
  };
}

module.exports = { loadConfig };
