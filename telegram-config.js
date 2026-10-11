'use strict';

// Telegram bot 的网页端配置：保存在 ${DATA_DIR}/telegram.json（0600，仅属主可读写）。
// .env 里填了 TELEGRAM_BOT_TOKEN 时环境变量优先，网页端只读展示（改配置需要改 .env 并重启）。

const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./validate');

const FILE = 'telegram.json';
const DEFAULT_API_BASE = 'https://api.telegram.org';

const fileOf = (dir) => path.join(dir, FILE);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// "42, 43" / "42 43" → ['42', '43']；非法 ID 直接抛错（网页表单需要明确反馈）。
function parseAllowedIds(raw) {
  const list = String(raw || '').split(/[,\s]+/).filter(Boolean);
  if (!list.length) throw new HttpError(400, '至少填写一个允许使用 bot 的数字用户 ID');
  for (const id of list) {
    if (!/^\d{1,15}$/.test(id)) throw new HttpError(400, `用户 ID "${id}" 无效（应为纯数字）`);
  }
  return [...new Set(list)];
}

function parseToken(raw) {
  const token = String(raw || '').trim();
  if (!token) throw new HttpError(400, '请填写 Telegram bot 的 token');
  if (token.length > 256) throw new HttpError(400, 'token 过长');
  return token;
}

// 空表示用默认地址；非空必须 https（本地回环 http 仅用于测试），且不能带账号口令。
function parseApiBase(raw) {
  const s = String(raw || '').trim().replace(/\/+$/, '');
  if (!s) return DEFAULT_API_BASE;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, `Telegram API 地址无效：${s}`);
  }
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname);
  if (u.username || u.password) throw new HttpError(400, 'Telegram API 地址不能带账号口令');
  if (u.protocol === 'http:' && !loopback) throw new HttpError(400, 'Telegram API 地址必须以 https:// 开头');
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Telegram API 地址协议不支持');
  return s;
}

// 日志和网页端只展示脱敏后的 token（"123456:ABC..." → "123456:***"），完整 token 只存在文件里。
function maskToken(token) {
  const s = String(token || '');
  const i = s.indexOf(':');
  return i > 0 ? `${s.slice(0, i)}:***` : '***';
}

function readTelegramConfig(dir, log = console) {
  const file = fileOf(dir);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn(`[panel] Telegram 配置文件无法读取（${err.message}），已忽略`);
    return null;
  }
  if (!isObj(parsed)) return null;
  return {
    token: typeof parsed.token === 'string' ? parsed.token : '',
    allowedIds: Array.isArray(parsed.allowedIds) ? parsed.allowedIds.filter((s) => /^\d{1,15}$/.test(String(s))).map(String) : [],
    apiBase: typeof parsed.apiBase === 'string' && parsed.apiBase ? parsed.apiBase : DEFAULT_API_BASE,
  };
}

// 先写临时文件再 rename，避免半个文件；0600 因为里面有 token。
function saveTelegramConfig(dir, { token, allowedIds, apiBase }) {
  const file = fileOf(dir);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ token, allowedIds, apiBase }, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* Windows 上 chmod 只是尽力而为 */
  }
  fs.renameSync(tmp, file);
}

function clearTelegramConfig(dir) {
  try {
    fs.rmSync(fileOf(dir), { force: true });
  } catch {
    /* 不存在也算成功 */
  }
}

module.exports = {
  DEFAULT_API_BASE,
  parseAllowedIds,
  parseToken,
  parseApiBase,
  maskToken,
  readTelegramConfig,
  saveTelegramConfig,
  clearTelegramConfig,
};
