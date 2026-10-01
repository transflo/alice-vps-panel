'use strict';

// 假 Telegram Bot API：作为 fetch 注入给 bot，记录所有调用。
function createFakeTelegram() {
  const calls = [];
  const handlers = {}; // method → (params) => result；抛错时按 Bot API 的错误格式返回
  const pollQueue = []; // 每个元素是一次长轮询要返回的 update 数组；队列空了就挂起直到被取消
  let messageId = 100;

  async function fetch(url, init = {}) {
    const m = /\/bot[^/]+\/([A-Za-z]+)$/.exec(String(url));
    const method = m[1];
    const params = init.body ? JSON.parse(init.body) : {};
    calls.push({ method, params });
    let result;
    if (method === 'getUpdates' && params.offset !== -1) {
      if (pollQueue.length) {
        result = pollQueue.shift();
      } else {
        // 长轮询：一直挂起直到被取消（bot.stop()）
        return new Promise((resolve, reject) => {
          if (init.signal) init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
    } else if (handlers[method]) {
      try {
        result = await handlers[method](params);
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error_code: err.code || 400, description: err.message }), { status: 200 });
      }
    } else if (method === 'sendMessage') result = { message_id: ++messageId, chat: { id: params.chat_id } };
    else if (method === 'getMe') result = { id: 1, username: 'alice_test_bot' };
    else result = true;
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
  }

  return {
    fetch,
    calls,
    handlers,
    pollQueue,
    of: (method) => calls.filter((c) => c.method === method).map((c) => c.params),
    sent: () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText').map((c) => c.params),
    clear: () => { calls.length = 0; },
  };
}

module.exports = { createFakeTelegram };
