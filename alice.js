'use strict';

// Alice EVO Cloud API（Ephemera API 2.0）客户端。
// 文档：https://web.archive.org/web/20260221171949/https://api.aliceinit.io/
// 鉴权：Authorization: Bearer <Client ID>:<Secret>，请求体为 JSON。
// 请求字段和 Alice 控制台推荐的 VSCode 插件（Montia37.aliceephemera）发送的一致。

const BASE = (process.env.ALICE_API_BASE || 'https://app.alice.ws/cli/v1').replace(/\/+$/, '');
const CLIENT_ID = process.env.ALICE_CLIENT_ID || '';
const SECRET = process.env.ALICE_SECRET || '';
const TIMEOUT_MS = Number(process.env.ALICE_TIMEOUT_MS) || 20000;

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

async function request(method, path, body) {
  if (!configured()) throw new AliceError('未配置 ALICE_CLIENT_ID / ALICE_SECRET', 503);

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

  const text = await res.text();
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
