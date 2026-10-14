'use strict';

// 环境变量解析与校验：非法值回退默认并警告，不让面板因为配置错误无法启动。
//
// 警告里一律不回显环境变量的**原始值**：日志会被容器收集、转发、长期留存，
// 而这些值里可能出现 `https://user:secret@host` 这种带账号口令的 URL
// （TELEGRAM_API_BASE 就允许用户这么填，虽然会被拒绝，但拒绝的原因不能把口令抄进日志）。
// 消息里只留变量名、约束条件和回退后的默认值，足够定位问题。

const path = require('node:path');
const { resolveOrigin } = require('./telegram');

function intInRange(raw, name, def, min, max, warn) {
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return n;
  warn(`${name} 的值无效（需为 ${min} ~ ${max} 的整数），已使用默认值 ${def}`);
  return def;
}

function timeZone(raw, def, warn) {
  if (raw === undefined || String(raw).trim() === '') return def;
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(raw).trim() });
    return String(raw).trim();
  } catch {
    warn(`DISPLAY_TIME_ZONE 的值不是有效的 IANA 时区，已使用默认值 ${def}`);
    return def;
  }
}

// API 地址的校验规则统一由 telegram.js 的 resolveOrigin 提供：只接受官方地址
// （以及显式开关下的本机回环地址）——那是唯一会把 bot token 发出去的地方。
// 规则放在同一处，是为了避免出现"config 收下了、真正发请求时才被拒"这种两边不一致的情况。
function apiBase(raw, def, name, warn) {
  const s = String(raw || '').trim();
  if (!s) return def;
  try {
    return resolveOrigin(s);
  } catch {
    // 不回显原始值（可能带账号口令），也不回显异常文本（可能把整段输入带回来）。
    warn(`${name} 的值无效或不受支持，已使用默认值 ${def}`);
    return def;
  }
}

function loadConfig(env = process.env, warn = (msg) => console.warn(`[panel] ${msg}`)) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const rawIds = String(env.TELEGRAM_ALLOWED_USER_IDS || '').split(/[,\s]+/).filter(Boolean);
  const allowedIds = rawIds.filter((s) => /^\d{1,15}$/.test(s));
  // 这里同样不回显具体的值（详见文件头）：它直接来自环境变量，而日志会被收集、转发、长期留存。
  if (rawIds.some((s) => !allowedIds.includes(s))) {
    warn('TELEGRAM_ALLOWED_USER_IDS 里有不是数字用户 ID 的值，已忽略（只接受 1 ~ 15 位纯数字）');
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
