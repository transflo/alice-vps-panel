'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const alice = require('./alice');
const { HttpError, POWER_ACTIONS, reqId, optId, hours, optText } = require('./validate');
const { loadConfig } = require('./config');
const { createStore, DEFAULT_AUTO_RENEW } = require('./store');
const { MAX_ATTEMPTS, createScheduler } = require('./scheduler');
const { createBot } = require('./bot');
const { createTelegram } = require('./telegram');
const {
  parseAllowedIds, parseToken, parseApiBase, maskToken,
  readTelegramConfig, saveTelegramConfig, clearTelegramConfig,
} = require('./telegram-config');
const { buildCsp, inlineScriptHashes } = require('./csp');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.PANEL_PASSWORD || '';
const SESSION_HOURS = (() => {
  const n = Number(process.env.SESSION_HOURS);
  if (Number.isInteger(n) && n >= 1 && n <= 720) return n;
  if (process.env.SESSION_HOURS !== undefined && String(process.env.SESSION_HOURS).trim() !== '') {
    console.warn(`[panel] SESSION_HOURS=${process.env.SESSION_HOURS} 无效（需为 1 ~ 720 的整数），已使用默认值 24`);
  }
  return 24;
})();
// 面板前面有几层反向代理：1 / true / yes 是 1 层，2 及以上的整数是多层（如 CDN + Nginx），其他值表示不信任转发头。
const TRUST_PROXY = (() => {
  const v = String(process.env.TRUST_PROXY).toLowerCase();
  if (v === 'true' || v === 'yes') return 1;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
})();
// 转发头（X-Forwarded-For）只有在「直连面板的对端」确实是受信代理时才可信，
// 否则任何能直达面板的人都能靠伪造这个头无限猜密码（限流按头里的地址计数）。
// 默认受信对端见 isTrustedProxy；TRUSTED_PROXY_IPS 一旦设置就**取代**默认列表。
const TRUSTED_PROXY_IPS = String(process.env.TRUSTED_PROXY_IPS || '')
  .split(/[,\s]+/)
  .filter(Boolean);
const COOKIE = 'alice_panel_session';

// 占位密码：从 .env.example 抄过来忘了改的，或写死在公开文档/字典里的值，一律拒绝。
const PLACEHOLDER_PASSWORDS = new Set([
  'change-me-please', 'change-me', 'changeme', 'changeme123', 'password', 'password123',
  '12345678', '123456789', 'admin123', 'alice-panel',
]);

if (PASSWORD.length < 8) {
  console.error('[panel] PANEL_PASSWORD 未设置或少于 8 位，拒绝启动。');
  process.exit(1);
}
if (PLACEHOLDER_PASSWORDS.has(PASSWORD.toLowerCase())) {
  console.error('[panel] PANEL_PASSWORD 是示例/字典里的占位密码，等于没有密码（面板能 root 登录你的实例），请改成你自己的密码后重启。');
  process.exit(1);
}
// Alice 凭据只会发往 ALICE_API_BASE：地址不安全（明文 http / 带账号口令）就拒绝启动，别把 secret 送出去。
if (alice.baseError()) {
  console.error(`[panel] ${alice.baseError()}，拒绝启动（Alice 凭据会明文泄露）。请修正 .env 里的 ALICE_API_BASE。`);
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

// 登录口令的比较：用 scrypt 摘成固定长度，再做常量时间比较（timingSafeEqual）。
// 先摘要的原因：timingSafeEqual 要求两个 Buffer 等长，直接比会因长度不同抛错，
// 而"长度不同就提前返回"本身又泄露口令长度。
//
// 为什么是 scrypt 而不是 sha256 / HMAC：口令摘要就该用慢哈希。本项目里口令并不落库
// （来自环境变量，只在进程内比对一次），慢哈希带来的实际收益有限，但这是口令处理的
// 标准做法，也能让 js/insufficient-password-hash 这条告警不必被长期当成噪音忽略。
//
// 代价是每次登录多花几十毫秒，所以登录接口把**限流判断放在 checkPassword 之前**
// （见 handleApi 的 /api/login）：被锁定的 IP 连一次摘要都跑不到。
// 用异步的 crypto.scrypt 而不是 scryptSync：慢哈希跑在 libuv 线程池里，不阻塞事件循环。
// salt 每进程随机生成一次、只活在内存里——两边都在同一个进程内算，不需要跨重启一致。
const SALT = crypto.randomBytes(16);
const KEY_LEN = 32;
const SCRYPT_PARAMS = { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scryptAsync = (s) => new Promise((resolve, reject) => {
  crypto.scrypt(String(s), SALT, KEY_LEN, SCRYPT_PARAMS, (err, key) => (err ? reject(err) : resolve(key)));
});
// 启动时算一次。算不出来就直接退出：否则这个 promise 会在第一次登录时才被 await，
// 中间这段时间的拒绝是"未处理"的，会直接把进程带走。
const PASSWORD_KEY = scryptAsync(PASSWORD).catch((err) => {
  console.error(`[panel] 口令摘要初始化失败（${err.message}），拒绝启动。`);
  process.exit(1);
});

async function checkPassword(input) {
  if (typeof input !== 'string') return false;
  return crypto.timingSafeEqual(await scryptAsync(input), await PASSWORD_KEY);
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

// 直连对端是否受信：回环、私有网段、链路本地地址，或 TRUSTED_PROXY_IPS 里显式列出的地址。
// TRUSTED_PROXY_IPS 非空时只认它列出的地址（不再用内置默认值）。
function isTrustedProxy(addr) {
  if (!addr) return false;
  const ip = /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(addr) ? addr.slice(7) : addr; // IPv4-mapped IPv6
  if (TRUSTED_PROXY_IPS.length) return TRUSTED_PROXY_IPS.includes(ip) || TRUSTED_PROXY_IPS.includes(addr);
  if (ip === '::1' || /^127\./.test(ip)) return true; // 回环
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true; // IPv4 链路本地
  if (/^f[cd][0-9a-f]{2}:/i.test(ip)) return true; // IPv6 ULA
  if (/^fe80:/i.test(ip)) return true; // IPv6 链路本地
  return false;
}

let warnedUntrustedPeer = false;

function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const header = req.headers['x-forwarded-for'];
  // 只有直连对端是受信代理时才看转发头：否则伪造 X-Forwarded-For 就能让限流按任意 IP 计数，
  // 5 次锁定形同虚设（面板密码后面是 deploy / destroy / exec，等于实例的 root）。
  const forwarded = TRUST_PROXY && isTrustedProxy(peer) ? header : '';
  if (TRUST_PROXY && !forwarded && header && !warnedUntrustedPeer) {
    warnedUntrustedPeer = true;
    console.warn(`[panel] 直连对端 ${peer || '未知'} 不在受信代理名单里，已忽略它发来的 X-Forwarded-For（登录限流按连接地址计数）。如果那确实是你的反向代理，请把它的地址填进 TRUSTED_PROXY_IPS。`);
  }
  if (forwarded) {
    // 每层代理把它看到的对端地址追加在右边，最左边的值是客户端自己写的，不能信。
    // 从右数第 TRUST_PROXY 个，才是最外一层受信代理看到的真实客户端。
    const hops = String(forwarded).split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) {
      // 转发头里的地址数量少于受信代理层数时，说明请求绕过了代理直达（或配置错误）：
      // 此时不能信任头里的任何值，回退到连接地址，避免限流被伪造 IP 绕过。
      if (hops.length < TRUST_PROXY) return peer || 'unknown';
      return hops[hops.length - TRUST_PROXY];
    }
  }
  return peer || 'unknown';
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

// 默认的 CSP 不允许任何内联脚本；HTML 页面会在发送时换成带有该页面内联脚本哈希的版本（见 csp.js）。
// HSTS 一并发出：面板自己只讲 HTTP，但反代转发给浏览器时这条头是走 HTTPS 的，浏览器才会采纳；
// 纯 HTTP 直连时按 RFC 6797 会被浏览器忽略，不会把本地调试搞坏。
const SECURITY_HEADERS = {
  'Content-Security-Policy': buildCsp(),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
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
    let settled = false;
    const chunks = [];
    // 超限时只停止读取（pause），不要 destroy：销毁连接会让 413 根本没机会发出去，
    // 客户端只看到连接被重置。Node 会在响应写完后自己关掉这条连接。
    const fail = (err) => {
      if (settled) return;
      settled = true;
      req.pause();
      reject(err);
    };
    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) fail(new HttpError(413, '请求内容过大'));
      else chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(new HttpError(400, '请求不是合法的 JSON'));
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
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
    // 网页弹窗里的说明文字用：到期前多久开始、最多试几次、两次之间隔多久、默认设置。
    policy: { beforeMinutes: config.renewBeforeMinutes, maxAttempts: MAX_ATTEMPTS, retryMinutes: config.renewRetryMinutes, defaultEnabled: DEFAULT_AUTO_RENEW.enabled, defaultHours: DEFAULT_AUTO_RENEW.hours },
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
  ['POST', new RegExp(`^${INST}/auto-renew$`), (m, b) => {
    if (typeof b.enabled !== 'boolean') throw new HttpError(400, 'enabled 需为 true 或 false');
    const prev = store.getAutoRenew(m[1]);
    // 关闭时可以不带 hours，沿用之前的设置（没有则按默认值）。
    const h = b.enabled || b.hours !== undefined ? hours(b.hours) : (prev ? prev.hours : DEFAULT_AUTO_RENEW.hours);
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
  // 纵深：Origin 存在时再校验同源，挡住 SameSite 缺陷或旧浏览器的边缘情况。
  if (method !== 'GET') {
    if (req.headers['x-panel'] !== '1') {
      return send(res, 403, { error: '缺少 X-Panel 请求头' });
    }
    const origin = req.headers.origin;
    if (origin) {
      try {
        const host = String(req.headers.host || '');
        if (host && new URL(origin).host !== host) {
          return send(res, 403, { error: 'Origin 校验失败' });
        }
      } catch {
        return send(res, 403, { error: 'Origin 校验失败' });
      }
    }
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    const f = failures.get(ip);
    if (f && f.count >= MAX_FAILURES && Date.now() - f.first < FAILURE_WINDOW) {
      return send(res, 429, { error: '失败次数过多，请 15 分钟后再试' });
    }
    const body = await readJson(req, 4096);
    if (!(await checkPassword(body.password))) {
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
    const token = sessionOf(req);
    // 未登录时不暴露 configured，避免匿名指纹探测。
    if (!token) return send(res, 200, { authenticated: false });
    return send(res, 200, { authenticated: true, configured: alice.configured() });
  }

  if (!sessionOf(req)) return send(res, 401, { error: '未登录' });

  // Telegram bot 的网页端配置：返回里永远不带完整 token。
  const telegramView = () => {
    const eff = effectiveTelegram();
    return {
      source: eff.source, // 'env'（.env，需改文件+重启）| 'file'（网页端管理）| null（未配置）
      managedByEnv: config.telegram.token !== '',
      enabled: eff.enabled,
      running: Boolean(bot),
      allowedIds: eff.allowedIds,
      apiBase: eff.apiBase,
      hasToken: Boolean(eff.token),
      tokenHint: eff.token ? maskToken(eff.token) : '',
      error: eff.error || undefined,
    };
  };

  if (pathname === '/api/telegram-config' && method === 'GET') {
    return send(res, 200, { data: telegramView() });
  }

  if (pathname === '/api/telegram-config' && method === 'POST') {
    if (config.telegram.token) {
      return send(res, 409, { error: 'bot 正由 .env 中的 TELEGRAM_* 配置管理：请先清空它们并重启容器，再通过网页端配置' });
    }
    const body = await readJson(req, 16 * 1024);
    if (body.enabled === false) {
      // 明确停用：清除已保存的配置并停掉正在跑的 bot。
      clearTelegramConfig(config.dataDir);
      stopBot();
      console.log('[bot] 已通过网页端停用（配置已清除）');
      return send(res, 200, { data: telegramView() });
    }
    const rawToken = body.token === undefined || body.token === null ? '' : String(body.token);
    const existing = readTelegramConfig(config.dataDir);
    // token 留空 = 沿用已保存的（只改用户 ID / API 地址）；从没配过则必须填写。
    const token = rawToken.trim() ? parseToken(rawToken) : (existing && existing.token ? existing.token : null);
    if (!token) throw new HttpError(400, '请填写 Telegram bot 的 token（从 @BotFather 获取）');
    const allowedIds = parseAllowedIds(Array.isArray(body.allowedIds) ? body.allowedIds.join(',') : body.allowedIds);
    const apiBase = parseApiBase(body.apiBase);
    // 先向 Telegram 验证（token 或地址可能换了），失败不碰正在跑的 bot。
    try {
      await createTelegram({ token, apiBase }).call('getMe');
    } catch (err) {
      const status = err.code === 0 ? 502 : 400;
      throw new HttpError(status, `Token 验证失败：${err.message}`);
    }
    try {
      saveTelegramConfig(config.dataDir, { token, allowedIds, apiBase });
    } catch (err) {
      throw new HttpError(503, `保存 Telegram 配置失败（DATA_DIR 不可写）：${err.message}`);
    }
    console.log(`[bot] 已通过网页端更新配置（允许 ${allowedIds.length} 个用户），正在重启`);
    startBot({ enabled: true, token, allowedIds, apiBase, source: 'file' });
    return send(res, 200, { data: telegramView() });
  }

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
// public/ 是前端构建产物（Next.js 静态导出，npm run build 生成，Docker 构建时自动完成），启动时全部读进内存。
// PUBLIC_DIR 可以指向别的目录（测试用）。

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
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
      // HTML 里的内联脚本（Next.js 的启动脚本和主题初始化）按各自页面的哈希放行。
      const csp = type.startsWith('text/html') ? buildCsp(inlineScriptHashes(body.toString('utf8'))) : undefined;
      staticFiles.set(urlPath, { body, type, etag, csp });
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
  // /_next/static/ 下的文件名带内容哈希，可以长期缓存；index.html 等每次向服务器确认。
  const cache = pathname.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  const headers = { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': cache, ETag: file.etag };
  if (file.csp) headers['Content-Security-Policy'] = file.csp;
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
  if (TRUST_PROXY !== 0) {
    // 不回显 TRUSTED_PROXY_IPS 的内容：它来自环境变量，而日志会被收集、转发、长期留存，
    // 没必要把内网代理的地址和拓扑写进去。下面两条消息都是字面量，只说清"信任谁"的规则。
    console.warn(TRUSTED_PROXY_IPS.length
      ? '[panel] 已启用反向代理支持：受信对端取 TRUSTED_PROXY_IPS 里列出的地址，只有直连对端在其中时才采信 X-Forwarded-For（登录限流按它计数）；X-Forwarded-Proto 仍无条件采信。请确保面板由反向代理转发，不要直接暴露到公网。'
      : '[panel] 已启用反向代理支持：受信对端为回环 / 私有网段 / 链路本地地址，只有直连对端在其中时才采信 X-Forwarded-For（登录限流按它计数）；X-Forwarded-Proto 仍无条件采信。反代跑在公网地址上时请设置 TRUSTED_PROXY_IPS。');
  }
});

// Telegram bot：失败默认关闭——没有 token / 白名单就不启动，面板其余功能不受影响。
// 配置来源：.env 里填了 TELEGRAM_BOT_TOKEN 就用环境变量（网页端只读）；
// 否则用网页端保存在 DATA_DIR/telegram.json 里的配置，可以热启停，不用重启容器。
let bot = null;

function botParams() {
  return {
    alice,
    store,
    displayTimeZone: config.displayTimeZone,
    renewBeforeMinutes: config.renewBeforeMinutes,
    renewRetryMinutes: config.renewRetryMinutes,
    renewMaxAttempts: MAX_ATTEMPTS,
  };
}

// 当前生效的 bot 配置（不含完整 token）：{ source: 'env' | 'file' | null, enabled, token, allowedIds, apiBase, error? }
function effectiveTelegram() {
  if (config.telegram.enabled) return { ...config.telegram, source: 'env' };
  const file = readTelegramConfig(config.dataDir);
  if (file && file.token && file.allowedIds.length) {
    return { enabled: true, token: file.token, allowedIds: file.allowedIds, apiBase: file.apiBase, source: 'file' };
  }
  const err = (file && file.token)
    ? '网页端保存了 bot token，但允许的用户 ID 为空，bot 不会启动'
    : config.telegram.error;
  return { enabled: false, token: '', allowedIds: [], apiBase: file ? file.apiBase : config.telegram.apiBase, source: file ? 'file' : null, error: err };
}

function stopBot() {
  if (bot) {
    bot.stop();
    bot = null;
  }
}

// 用新配置（已校验过）换掉正在跑的 bot：先停旧的，再起新的；启动失败只记日志，不影响面板。
function startBot(eff) {
  stopBot();
  bot = createBot({ token: eff.token, allowedIds: eff.allowedIds, apiBase: eff.apiBase, ...botParams() });
  bot.start().then((ok) => {
    if (!ok) {
      console.error('[bot] token 无效，bot 已停用（面板其余功能正常）');
      stopBot();
    }
  });
  // 打个招呼，顺便验证消息能送到白名单用户手里；某个用户失败不影响其他人。
  const tg = createTelegram({ token: eff.token, apiBase: eff.apiBase });
  for (const id of eff.allowedIds) {
    tg.call('sendMessage', { chat_id: Number(id), text: '✅ Alice 面板 Telegram 通知已启用。发送 /help 查看可用命令。' })
      .catch((err) => console.warn(`[bot] 欢迎消息发送给 ${id} 失败：${err.message}（请先对 bot 发送 /start）`));
  }
}

const initialTelegram = effectiveTelegram();
if (initialTelegram.enabled) {
  startBot(initialTelegram);
} else if (initialTelegram.error) {
  console.error(`[bot] ${initialTelegram.error}`);
}

const scheduler = createScheduler({
  alice,
  store,
  notify: (event) => (bot ? bot.notify(event) : Promise.resolve()),
  cfg: {
    renewBeforeMs: config.renewBeforeMinutes * 60e3,
    retryGapMs: config.renewRetryMinutes * 60e3,
    // 用 getter：网页端随时可能启停 bot，调度器每轮按最新状态决定要不要发到期提醒。
    get botEnabled() { return Boolean(bot); },
    intervalMs: config.intervalSeconds * 1000,
  },
});
scheduler.start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (bot) bot.stop();
    process.exit(0);
  });
}
