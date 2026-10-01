'use strict';

// Telegram Bot API 的最小客户端：POST JSON，只返回 result。
// 错误信息里不带 token（也不带含 token 的 URL）。

function createTelegram({ token, apiBase, fetch = globalThis.fetch }) {
  async function call(method, params = {}, { timeoutMs = 15000, signal } = {}) {
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (signal) signals.push(signal);
    let res;
    try {
      res = await fetch(`${apiBase}/bot${token}/${method}`, {
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
      payload = await res.json();
    } catch {
      throw Object.assign(new Error(`Telegram 返回了非 JSON 内容（${method}，HTTP ${res.status}）`), { code: res.status });
    }
    if (!payload.ok) {
      throw Object.assign(new Error(payload.description || `Telegram 错误（${method}）`), { code: payload.error_code || res.status });
    }
    return payload.result;
  }
  return { call };
}

module.exports = { createTelegram };
