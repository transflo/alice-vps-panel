'use strict';

// 本地假 Alice API：用于集成测试和手动验收（ALICE_API_BASE 指向它）。
// 复刻真实数据的怪癖：creation_at 的钟面是 UTC+8 但标签写成 +01:00，expiration_at 用 +01:00 自洽表示。

const http = require('node:http');

const HOUR = 3600e3;
// 与 Alice 一致：创建时间 = UTC+8 的钟面 + 错误的 +01:00 标签
const creationAt = (ms) => `${new Date(ms + 8 * HOUR).toISOString().slice(0, 19)}+01:00`;
// 到期时间 = 真实的 +01:00 钟面
const expirationAt = (ms) => `${new Date(ms + HOUR).toISOString().slice(0, 19)}+01:00`;

function makeInstance(id, { createdMs, expiresMs, hostname = `vm-${id}` }) {
  return {
    id,
    hostname,
    status: 'active',
    plan_id: 38,
    ipv4: '203.0.113.7',
    creation_at: creationAt(createdMs),
    expiration_at: expirationAt(expiresMs),
  };
}

function startMockAlice(port = 0) {
  const instances = [];
  const calls = [];
  const api = { failRenewals: false }; // 置 true 时续期接口返回错误（模拟余额不足）
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const body = text ? JSON.parse(text) : undefined;
      const url = req.url.split('?')[0];
      calls.push({ method: req.method, path: url, body });
      const send = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      const ok = (data) => send(200, { code: 200, message: 'ok', data });
      let m;
      if (req.method === 'GET' && url === '/evo/instances') return ok(instances);
      if (req.method === 'GET' && /^\/evo\/instances\/[^/]+\/state$/.test(url)) {
        return ok({ status: 'complete', state: { state: 'running', cpu: 1.5 } });
      }
      if (req.method === 'POST' && (m = url.match(/^\/evo\/instances\/([^/]+)\/renewals$/))) {
        if (api.failRenewals) return send(402, { code: 402, message: '余额不足' });
        const inst = instances.find((i) => String(i.id) === m[1]);
        if (!inst) return send(404, { code: 404, message: 'not found' });
        inst.expiration_at = expirationAt(Date.parse(inst.expiration_at) + body.time * HOUR);
        return ok({ expiration_at: inst.expiration_at });
      }
      if (req.method === 'DELETE' && (m = url.match(/^\/evo\/instances\/([^/]+)$/))) {
        const i = instances.findIndex((x) => String(x.id) === m[1]);
        if (i >= 0) instances.splice(i, 1);
        return ok(null);
      }
      return send(404, { code: 404, message: 'not found' });
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        instances,
        calls,
        api,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

module.exports = { startMockAlice, makeInstance, HOUR };
