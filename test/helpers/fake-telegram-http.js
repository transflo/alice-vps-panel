'use strict';

// 本地假 Telegram Bot API（真正的 HTTP 服务）：用于启动真实的 server.js 做端到端测试，
// 通过 TELEGRAM_API_BASE 指向它。记录收到的 sendMessage；可以预先塞几条用户发来的 update。

const http = require('node:http');

function startFakeTelegram({ updates = [] } = {}) {
  const messages = []; // 收到的 sendMessage 参数
  const queue = [...updates];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const m = /\/bot[^/]+\/([A-Za-z]+)$/.exec(req.url);
      const method = m && m[1];
      const params = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      const reply = (result, delay = 0) => setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result }));
      }, delay);
      if (method === 'getMe') return reply({ id: 1, username: 'alice_test_bot' });
      if (method === 'getUpdates') {
        if (params.offset === -1) return reply([]); // 启动时丢弃积压
        return queue.length ? reply(queue.splice(0)) : reply([], 300); // 长轮询：没有新消息就稍等再返回空
      }
      if (method === 'sendMessage') {
        messages.push(params);
        return reply({ message_id: messages.length, chat: { id: params.chat_id } });
      }
      return reply(true);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        messages,
        close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
      });
    });
  });
}

module.exports = { startFakeTelegram };
