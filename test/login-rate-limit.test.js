'use strict';

// 登录限流的回归测试：启动真实的 server.js，只通过 HTTP 访问。
// 面板放在反向代理后面（TRUST_PROXY）时按 X-Forwarded-For 区分客户端，
// 这里验证客户端自己伪造的地址不能用来绕过「同一 IP 连续 5 次密码错误后锁定」。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startPanel(t, env) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PANEL_PASSWORD: 'correct-password', HOST: '127.0.0.1', PORT: String(port), ...env },
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return base;
    } catch {
      /* 还没启动完 */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('面板没有在 5 秒内启动');
}

// 用错误密码登录一次，返回 HTTP 状态码（401 = 密码错误，429 = 已被锁定）。
async function wrongLogin(base, forwardedFor) {
  const headers = { 'Content-Type': 'application/json', 'X-Panel': '1' };
  if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ password: 'wrong-password' }),
  });
  return res.status;
}

test('TRUST_PROXY=1：同一个真实客户端换着伪造 X-Forwarded-For 也会被锁定', async (t) => {
  const base = await startPanel(t, { TRUST_PROXY: '1' });
  // 代理把它看到的客户端地址追加在最右边，最左边的是客户端自己写的，每次都不一样。
  const statuses = [];
  for (let i = 1; i <= 6; i++) statuses.push(await wrongLogin(base, `198.51.100.${i}, 203.0.113.5`));
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});

test('TRUST_PROXY=1：被锁定的客户端不会连累其他客户端', async (t) => {
  const base = await startPanel(t, { TRUST_PROXY: '1' });
  for (let i = 0; i < 5; i++) await wrongLogin(base, '203.0.113.5');
  assert.equal(await wrongLogin(base, '203.0.113.5'), 429);
  assert.equal(await wrongLogin(base, '203.0.113.6'), 401);
});

test('TRUST_PROXY=2：两层代理时取从右数第 2 个地址作为真实客户端', async (t) => {
  const base = await startPanel(t, { TRUST_PROXY: '2' });
  // 客户端 203.0.113.5 → 代理 A(192.0.2.1) → 代理 B → 面板：
  // B 追加了它看到的 A 的地址，A 追加了客户端的地址，最左边仍是客户端伪造的。
  for (let i = 1; i <= 5; i++) await wrongLogin(base, `198.51.100.${i}, 203.0.113.5, 192.0.2.1`);
  assert.equal(await wrongLogin(base, '198.51.100.9, 203.0.113.5, 192.0.2.1'), 429);
  assert.equal(await wrongLogin(base, '198.51.100.9, 203.0.113.6, 192.0.2.1'), 401);
});

test('TRUST_PROXY=2 但转发头里只有一个地址：用这个地址，不把所有人算成同一个客户端', async (t) => {
  const base = await startPanel(t, { TRUST_PROXY: '2' });
  for (let i = 0; i < 5; i++) await wrongLogin(base, '203.0.113.5');
  assert.equal(await wrongLogin(base, '203.0.113.5'), 429);
  assert.equal(await wrongLogin(base, '203.0.113.6'), 401);
});

test('TRUST_PROXY=0：完全忽略 X-Forwarded-For，按连接地址限流', async (t) => {
  const base = await startPanel(t, { TRUST_PROXY: '0' });
  const statuses = [];
  for (let i = 1; i <= 6; i++) statuses.push(await wrongLogin(base, `203.0.113.${i}`));
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429]);
});
