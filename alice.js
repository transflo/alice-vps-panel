'use strict';

// Alice EVO Cloud API（Ephemera API 2.0）客户端。
// 文档：https://web.archive.org/web/20260221171949/https://api.aliceinit.io/
// 鉴权：Authorization: Bearer <Client ID>:<Secret>，请求体为 JSON。
// 请求字段和 Alice 控制台推荐的 VSCode 插件（Montia37.aliceephemera）发送的一致。

const BASE = (process.env.ALICE_API_BASE || 'https://app.alice.ws/cli/v1').replace(/\/+$/, '');
const CLIENT_ID = process.env.ALICE_CLIENT_ID || '';
const SECRET = process.env.ALICE_SECRET || '';
// 上游响应上限：防止被入侵/MITM 的 Alice 返回超大 body 导致 OOM（真正生效的读取见 readCapped）。
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// ALICE_API_BASE 的校验结果，null 表示可用。凭据是用 Authorization 头带出去的：
// 只要 BASE 是明文 http（非回环）或 URL 里带了账号口令，凭据就会泄露，所以 fail closed
// ——server.js 启动时拒绝启动，request() 也不会把请求发出去。
const BASE_ERROR = (() => {
  let u;
  try {
    u = new URL(BASE);
  } catch {
    return 'ALICE_API_BASE 不是合法 URL';
  }
  if (u.username || u.password) return 'ALICE_API_BASE 不能带账号口令';
  if (u.protocol === 'http:') {
    const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(u.hostname);
    if (!loopback) return 'ALICE_API_BASE 用 http 会把 Alice 凭据明文发出去，必须用 https（仅回环地址允许 http，供测试用）';
    return null;
  }
  if (u.protocol !== 'https:') return `ALICE_API_BASE 协议不支持（${u.protocol}）`;
  return null;
})();

// AbortSignal.timeout 只接受 0 ~ 4294967295 的整数；超范围会抛 RangeError，
// 而且这行在 try 之外，会把每个 Alice 请求都变成 500。这里按 config.js 的惯例回退默认值。
const TIMEOUT_MS = (() => {
  const raw = process.env.ALICE_TIMEOUT_MS;
  if (raw === undefined || String(raw).trim() === '') return 20000;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 600000) return n;
  console.warn(`[panel] ALICE_TIMEOUT_MS=${raw} 无效（需为 1 ~ 600000 的整数毫秒），已使用默认值 20000`);
  return 20000;
})();

const { parseClockOffset, withUtcTimes } = require('./alice-time');

const CLOCK_OFFSET = parseClockOffset(process.env.ALICE_CLOCK_OFFSET, (msg) => console.warn(`[panel] ${msg}`));

// 列表可能直接是数组，也可能包在 { list: [...] } 之类的对象里：给每个数组里的对象追加规范化后的时间。
function withTimesInList(data) {
  if (Array.isArray(data)) return data.map((r) => withUtcTimes(r, CLOCK_OFFSET));
  if (data && typeof data === 'object') {
    const out = { ...data };
    for (const k of Object.keys(out)) {
      if (Array.isArray(out[k])) out[k] = out[k].map((r) => withUtcTimes(r, CLOCK_OFFSET));
    }
    return out;
  }
  return data;
}

class AliceError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

function configured() {
  return Boolean(CLIENT_ID && SECRET);
}

function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

// 纯数字的 ID 按数字发送，和文档示例（"product_id": 38）保持一致。
function idValue(v) {
  if (v === undefined || v === null || v === '') return null;
  return /^\d+$/.test(String(v)) ? Number(v) : String(v);
}

// 可选参数：不用 SSH 密钥时不发送 ssh_key_id，启动脚本为空时不发送 boot_script。
function withOptional(body, { sshKeyId, bootScript }) {
  const key = idValue(sshKeyId);
  if (key !== null) body.ssh_key_id = key;
  if (bootScript) body.boot_script = b64(bootScript);
  return body;
}

// 按上限流式读取响应体：res.text() 会先把整个 body 读进内存再判断长度，
// 那个「上限」等于没有，被入侵的 Alice（或 MITM）仍能把面板撑爆。这里边读边数，超了就断开。
async function readCapped(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        try {
          await reader.cancel();
        } catch {
          /* 流已经出错时 cancel 会抛，忽略即可 */
        }
        throw new AliceError(`Alice API 返回内容过大（超过 ${max} 字节，已拒绝）`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 已释放 */
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function request(method, path, body) {
  if (!configured()) throw new AliceError('未配置 ALICE_CLIENT_ID / ALICE_SECRET', 503);
  if (BASE_ERROR) throw new AliceError(`${BASE_ERROR}；为避免凭据泄露，已拒绝发送请求`, 503);

  const headers = { Authorization: `Bearer ${CLIENT_ID}:${SECRET}`, Accept: 'application/json' };
  const init = { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? '请求超时' : (err.cause && err.cause.code) || err.message;
    throw new AliceError(`无法连接 Alice API：${reason}`);
  }

  const text = await readCapped(res, MAX_BODY_BYTES);
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    if (res.status === 202) return null; // 已受理、尚未完成
    throw new AliceError(`Alice API 返回了非 JSON 内容（HTTP ${res.status}）`);
  }

  const isObj = payload && typeof payload === 'object' && !Array.isArray(payload);
  const message = isObj ? payload.message || payload.msg || payload.error : '';
  if (res.status === 401) {
    throw new AliceError(`Alice API 凭据无效，请检查 ALICE_CLIENT_ID / ALICE_SECRET${message ? `（${message}）` : ''}`);
  }
  if (!res.ok) {
    throw new AliceError(`Alice API 错误（HTTP ${res.status}）${message ? `：${message}` : ''}`);
  }
  // 返回包在 { code, message, data } 里，code 与 HTTP 状态码相同；2xx 以外视为失败。
  // 命令还没执行完时查询结果返回 202，前端据此继续轮询。
  if (isObj && typeof payload.code === 'number' && payload.code !== 0 && (payload.code < 200 || payload.code > 299)) {
    throw new AliceError(message || `Alice API 返回错误码 ${payload.code}`);
  }
  if (isObj && payload.success === false) {
    throw new AliceError(message || 'Alice API 返回失败');
  }
  return isObj && 'data' in payload ? payload.data : payload;
}

const seg = encodeURIComponent;

module.exports = {
  AliceError,
  BASE,
  configured,
  // 非 null 表示 ALICE_API_BASE 不安全（明文 http / 带账号口令 / 非法），server.js 据此拒绝启动。
  baseError: () => BASE_ERROR,

  profile: () => request('GET', '/account/profile'),
  sshKeys: () => request('GET', '/account/ssh-keys'),
  permissions: () => request('GET', '/evo/permissions'),
  plans: () => request('GET', '/evo/plans'),
  planImages: (planId) => request('GET', `/evo/plans/${seg(planId)}/os-images`),

  listInstances: async () => withTimesInList(await request('GET', '/evo/instances')),
  deploy: ({ planId, osId, hours, sshKeyId, bootScript }) =>
    request('POST', '/evo/instances/deploy', withOptional(
      { product_id: idValue(planId), os_id: idValue(osId), time: hours },
      { sshKeyId, bootScript },
    )),
  destroy: (id) => request('DELETE', `/evo/instances/${seg(id)}`),
  state: (id) => request('GET', `/evo/instances/${seg(id)}/state`),
  // action: boot | shutdown | restart | poweroff
  power: (id, action) => request('POST', `/evo/instances/${seg(id)}/power`, { action }),
  // 文档的请求示例写的是 os / sshKey / bootScript，但参数说明和 VSCode 插件用的都是 os_id / ssh_key_id / boot_script。
  rebuild: (id, { osId, sshKeyId, bootScript }) =>
    request('POST', `/evo/instances/${seg(id)}/rebuild`, withOptional({ os_id: idValue(osId) }, { sshKeyId, bootScript })),
  renew: async (id, hours) =>
    withUtcTimes(await request('POST', `/evo/instances/${seg(id)}/renewals`, { time: hours }), CLOCK_OFFSET),
  exec: (id, command) => request('POST', `/evo/instances/${seg(id)}/exec`, { command: b64(command) }),
  execResult: (id, uid) => request('GET', `/evo/instances/${seg(id)}/exec/${seg(uid)}`),
};
