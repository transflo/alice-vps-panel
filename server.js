'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const alice = require('./alice');
const { HttpError, POWER_ACTIONS, reqId, optId, hours, optText } = require('./validate');
const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { MAX_ATTEMPTS, createScheduler } = require('./scheduler');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.PANEL_PASSWORD || '';
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 24;
// 面板前面有几层反向代理：1 / true / yes 是 1 层，2 及以上的整数是多层（如 CDN + Nginx），其他值表示不信任转发头。
const TRUST_PROXY = (() => {
  const v = String(process.env.TRUST_PROXY).toLowerCase();
  if (v === 'true' || v === 'yes') return 1;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
})();
const COOKIE = 'alice_panel_session';

if (PASSWORD.length < 8) {
  console.error('[panel] PANEL_PASSWORD 未设置或少于 8 位，拒绝启动。');
  process.exit(1);
}
if (!alice.configured()) {
  console.warn('[panel] 未设置 ALICE_CLIENT_ID / ALICE_SECRET：可以登录面板，但无法调用 Alice API。');
}

const config = loadConfig();
const store = createStore({ dir: config.dataDir });

// ---------- 会话与登录限流 ----------

const sessions = new Map(); // token -> 过期时间戳
const failures = new Map(); // ip -> { count, first }
const MAX_FAILURES = 5;
const FAILURE_WINDOW = 15 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sessions) if (exp < now) sessions.delete(t);
  for (const [ip, f] of failures) if (now - f.first > FAILURE_WINDOW) failures.delete(ip);
}, 10 * 60 * 1000).unref();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();
const PASSWORD_HASH = sha256(PASSWORD);

function checkPassword(input) {
  return typeof input === 'string' && crypto.timingSafeEqual(sha256(input), PASSWORD_HASH);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* 忽略无法解码的 Cookie */
    }
  }
  return out;
}

function sessionOf(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function clientIp(req) {
  const forwarded = TRUST_PROXY && req.headers['x-forwarded-for'];
  if (forwarded) {
    // 每层代理把它看到的对端地址追加在右边，最左边的值是客户端自己写的，不能信。
    // 从右数第 TRUST_PROXY 个，才是最外一层受信代理看到的真实客户端。
    const hops = String(forwarded).split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[Math.max(0, hops.length - TRUST_PROXY)];
  }
  return req.socket.remoteAddress || 'unknown';
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
}

function sessionCookie(req, token, maxAgeSec) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

// ---------- HTTP 工具 ----------

// MUI（Emotion）在运行时插入 <style>，所以样式需要 'unsafe-inline'；脚本仍然只允许同源文件。
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, '请求内容过大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(new HttpError(400, '请求不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- API 路由 ----------

async function settle(promise) {
  try {
    return { ok: true, data: await promise };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const INST = '/api/instances/([A-Za-z0-9_-]{1,64})';

const routes = [
  ['GET', /^\/api\/overview$/, async () => {
    const [profile, permissions] = await Promise.all([settle(alice.profile()), settle(alice.permissions())]);
    return { profile, permissions };
  }],
  ['GET', /^\/api\/auto-renew$/, () => ({
    available: store.available,
    items: store.listAutoRenew(),
    // 网页弹窗里的说明文字用：到期前多久开始、最多试几次、两次之间隔多久。
    policy: { beforeMinutes: config.renewBeforeMinutes, maxAttempts: MAX_ATTEMPTS, retryMinutes: config.renewRetryMinutes },
  })],
  ['GET', /^\/api\/ssh-keys$/, () => alice.sshKeys()],
  ['GET', /^\/api\/plans$/, () => alice.plans()],
  ['GET', /^\/api\/plans\/([A-Za-z0-9_-]{1,64})\/os-images$/, (m) => alice.planImages(m[1])],

  ['GET', /^\/api\/instances$/, () => alice.listInstances()],
  ['POST', /^\/api\/instances$/, (m, b) => alice.deploy({
    planId: reqId(b.plan_id, '套餐'),
    osId: reqId(b.os_id, '系统'),
    hours: hours(b.time),
    sshKeyId: optId(b.ssh_key_id, 'SSH 密钥'),
    bootScript: optText(b.boot_script, '启动脚本', 64 * 1024),
  })],
  ['GET', new RegExp(`^${INST}/state$`), (m) => alice.state(m[1])],
  ['POST', new RegExp(`^${INST}/power$`), (m, b) => {
    if (!POWER_ACTIONS.includes(b.action)) throw new HttpError(400, '无效的电源操作');
    return alice.power(m[1], b.action);
  }],
  ['POST', new RegExp(`^${INST}/rebuild$`), (m, b) => alice.rebuild(m[1], {
    osId: reqId(b.os_id, '系统'),
    sshKeyId: optId(b.ssh_key_id, 'SSH 密钥'),
    bootScript: optText(b.boot_script, '启动脚本', 64 * 1024),
  })],
  ['POST', new RegExp(`^${INST}/renewals$`), (m, b) => alice.renew(m[1], hours(b.time))],
  ['POST', new RegExp(`^${INST}/auto-renew$`), (m, b) => {
    if (typeof b.enabled !== 'boolean') throw new HttpError(400, 'enabled 需为 true 或 false');
    const prev = store.getAutoRenew(m[1]);
    // 关闭时可以不带 hours，沿用之前的设置（没有则 24）。
    const h = b.enabled || b.hours !== undefined ? hours(b.hours) : (prev ? prev.hours : 24);
    store.setAutoRenew(m[1], { enabled: b.enabled, hours: h });
    return { enabled: b.enabled, hours: h };
  }],
  ['DELETE', new RegExp(`^${INST}$`), async (m) => {
    const result = await alice.destroy(m[1]);
    store.removeInstance(m[1]);
    return result;
  }],
  ['POST', new RegExp(`^${INST}/exec$`), (m, b) => {
    const command = optText(b.command, '命令', 16 * 1024);
    if (!command || !command.trim()) throw new HttpError(400, '命令不能为空');
    return alice.exec(m[1], command);
  }],
  ['GET', new RegExp(`^${INST}/exec/([A-Za-z0-9_-]{1,128})$`), (m) => alice.execResult(m[1], m[2])],
];

async function handleApi(req, res, pathname) {
  const method = req.method;

  // 修改类请求必须带自定义头：跨站页面无法在不触发预检的情况下伪造它（CSRF 防护）。
  if (method !== 'GET' && req.headers['x-panel'] !== '1') {
    return send(res, 403, { error: '缺少 X-Panel 请求头' });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    const f = failures.get(ip);
    if (f && f.count >= MAX_FAILURES && Date.now() - f.first < FAILURE_WINDOW) {
      return send(res, 429, { error: '失败次数过多，请 15 分钟后再试' });
    }
    const body = await readJson(req, 4096);
    if (!checkPassword(body.password)) {
      if (!f || Date.now() - f.first > FAILURE_WINDOW) failures.set(ip, { count: 1, first: Date.now() });
      else f.count += 1;
      console.warn(`[panel] 登录失败 ip=${ip}`);
      return send(res, 401, { error: '密码错误' });
    }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + SESSION_HOURS * 3600 * 1000);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, token, SESSION_HOURS * 3600) });
  }

  if (pathname === '/api/logout' && method === 'POST') {
    const token = sessionOf(req);
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (pathname === '/api/session' && method === 'GET') {
    return send(res, 200, { authenticated: Boolean(sessionOf(req)), configured: alice.configured() });
  }

  if (!sessionOf(req)) return send(res, 401, { error: '未登录' });

  for (const [m, re, handler] of routes) {
    if (m !== method) continue;
    const match = pathname.match(re);
    if (!match) continue;
    const body = method === 'POST' ? await readJson(req) : {};
    const data = await handler(match, body);
    if (method !== 'GET') console.log(`[panel] ${method} ${pathname} ok`);
    return send(res, 200, { data: data === undefined ? null : data });
  }
  return send(res, 404, { error: '接口不存在' });
}

// ---------- 静态文件 ----------
// public/ 是前端构建产物（在 web/ 目录运行 npm run build 生成，Docker 构建时自动完成），启动时全部读进内存。

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
const staticFiles = new Map();

function loadStatic(dir, prefix) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const urlPath = `${prefix}/${entry.name}`;
    const type = MIME[path.extname(entry.name).toLowerCase()];
    if (entry.isDirectory()) {
      loadStatic(full, urlPath);
    } else if (entry.isFile() && type) {
      const body = fs.readFileSync(full);
      const etag = `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
      staticFiles.set(urlPath, { body, type, etag });
    }
  }
}

loadStatic(PUBLIC_DIR, '');
if (!staticFiles.has('/index.html')) {
  console.warn('[panel] 没有找到前端文件 public/index.html：请先运行 npm run build（Docker 部署会自动构建）。');
}

function handleStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method Not Allowed' });
  const file = staticFiles.get(pathname === '/' ? '/index.html' : pathname);
  if (!file) {
    const missingUi = pathname === '/' || pathname === '/index.html';
    return send(res, missingUi ? 503 : 404, missingUi ? '前端尚未构建，请查看 README。' : 'Not Found', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  }
  // /assets/ 下的文件名带内容哈希，可以长期缓存；index.html 等每次向服务器确认。
  const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  const headers = { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': cache, ETag: file.etag };
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : file.body);
}

// ---------- 启动 ----------

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return send(res, 400, { error: 'Bad Request' });
  }
  try {
    if (pathname === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    return handleStatic(req, res, pathname);
  } catch (err) {
    const status = err instanceof HttpError || err instanceof alice.AliceError ? err.status : 500;
    if (status >= 500) console.error(`[panel] ${req.method} ${pathname} 失败：${err.message}`);
    if (!res.headersSent) send(res, status, { error: status === 500 ? '服务器内部错误' : err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[panel] 已启动：http://${HOST}:${PORT}  Alice API：${alice.BASE}`);
});

const scheduler = createScheduler({
  alice,
  store,
  notify: async () => {}, // 之后接入 Telegram 推送
  cfg: {
    renewBeforeMs: config.renewBeforeMinutes * 60e3,
    retryGapMs: config.renewRetryMinutes * 60e3,
    warnBeforeMs: config.warnMinutes * 60e3,
    botEnabled: false,
    intervalMs: config.intervalSeconds * 1000,
  },
});
scheduler.start();

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
