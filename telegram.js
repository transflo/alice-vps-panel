'use strict';

// Telegram Bot API 的最小客户端：POST JSON，只返回 result。
// 错误信息里不带 token（也不带含 token 的 URL）。

// token 和 method 都会被拼进请求 URL，所以先卡死字符集：token 只允许 Telegram
// 官方格式里会出现的字符（数字、":"、字母数字、下划线、连字符），method 只可能是纯字母。
// 这样 "/"、"@"、"?"、"#"、".."、空白都进不来，拼出来的地址不可能离开下面定好的 origin。
const TOKEN_RE = /^[A-Za-z0-9_:-]{1,256}$/;
const METHOD_RE = /^[A-Za-z]{1,32}$/;

// 允许的 API 地址：官方地址，或在显式开关下的本机回环地址（仅测试用）。
const OFFICIAL_ORIGIN = 'https://api.telegram.org';
const LOOPBACK_RE = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/;
const LOOPBACK_HOST = '127.0.0.1';

// 把配置里的地址收敛成一个 **origin**。两个分支返回的都是"由常量拼出来的"字符串，
// 而不是调用方传进来的那个值：官方分支直接返回常量，回环分支只用
// 常量主机 + 校验过的整数端口重建。这样拼 URL 用的 origin 与配置值之间没有数据流，
// 请求不可能发到 api.telegram.org（或显式放行的本机回环地址）以外。
function resolveOrigin(apiBase) {
  let u;
  try {
    u = new URL(String(apiBase));
  } catch {
    throw Object.assign(new Error('Telegram API 地址无效'), { code: 0 });
  }
  if (u.username || u.password) {
    throw Object.assign(new Error('Telegram API 地址不能带账号口令'), { code: 0 });
  }
  if (u.search || u.hash) {
    throw Object.assign(new Error('Telegram API 地址不能带查询串'), { code: 0 });
  }
  if (u.pathname !== '/') {
    throw Object.assign(new Error('Telegram API 地址不能带路径'), { code: 0 });
  }
  if (u.origin === OFFICIAL_ORIGIN) {
    return OFFICIAL_ORIGIN;
  }
  if (process.env.TELEGRAM_API_BASE_ALLOW_LOOPBACK === '1'
    && (u.protocol === 'http:' || u.protocol === 'https:')
    && LOOPBACK_RE.test(u.hostname)) {
    // 端口和协议是这里仅有的两个可变部分：协议收敛成两个字面量之一，端口收敛成
    // 1~65535 的整数，再用常量模板重建。不把调用方给的字符串直接返回。
    // 副作用：localhost 和 [::1] 都会归一成 127.0.0.1（本机测试服务器本来就监听在它上面）。
    const port = Number(u.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw Object.assign(new Error('Telegram API 地址端口无效'), { code: 0 });
    }
    const scheme = u.protocol === 'https:' ? 'https' : 'http';
    return `${scheme}://${LOOPBACK_HOST}:${port}`;
  }
  throw Object.assign(new Error('Telegram API 地址仅支持 https://api.telegram.org'), { code: 0 });
}

function createTelegram({ token, apiBase, fetch = globalThis.fetch }) {
  const MAX_BODY_BYTES = 1 * 1024 * 1024;
  const origin = resolveOrigin(apiBase);

  async function call(method, params = {}, { timeoutMs = 15000, signal } = {}) {
    if (!TOKEN_RE.test(String(token))) {
      throw Object.assign(new Error('Telegram token 含非法字符，已拒绝发送'), { code: 0 });
    }
    if (!METHOD_RE.test(String(method))) {
      throw Object.assign(new Error('Telegram 方法名非法，已拒绝发送'), { code: 0 });
    }
    // 拼的是绝对地址，不能用相对引用：token 里必然有 ":"（如 123:abc），
    // `new URL('bot123:abc/sendMessage', base)` 会把 "bot123:" 当成协议名解析成完全不同的地址。
    const url = `${origin}/bot${token}/${method}`;
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.any(signals),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? '请求超时' : err.name === 'AbortError' ? '已取消' : (err.cause && err.cause.code) || err.message;
      throw Object.assign(new Error(`无法连接 Telegram（${method}）：${reason}`), { code: 0 });
    }
    let payload;
    try {
      const text = await res.text();
      if (text.length > MAX_BODY_BYTES) {
        throw Object.assign(new Error(`Telegram 返回内容过大（${method}）`), { code: res.status });
      }
      payload = text ? JSON.parse(text) : {};
    } catch (err) {
      if (err.code !== undefined) throw err;
      throw Object.assign(new Error(`Telegram 返回了非 JSON 内容（${method}，HTTP ${res.status}）`), { code: res.status });
    }
    if (!payload.ok) {
      throw Object.assign(new Error(payload.description || `Telegram 错误（${method}）`), { code: payload.error_code || res.status });
    }
    return payload.result;
  }
  return { call };
}

module.exports = { createTelegram, resolveOrigin };
