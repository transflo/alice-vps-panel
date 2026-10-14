'use strict';

// 启动期的拒绝逻辑与请求体上限：起真实的 server.js 验证，而不是只读代码。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-hard-'));
const GOOD_PASSWORD = 'a-good-password';

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

// 只关心启动阶段：拿到子进程和它的 stderr。
function startRaw(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, HOST: '127.0.0.1', DATA_DIR: tmpDir(), ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  return { child, stderr: () => stderr };
}

const exitCode = (child, ms = 10000) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), ms);
  child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
});

async function startPanel(t) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PANEL_PASSWORD: GOOD_PASSWORD, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: tmpDir() },
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
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('面板没有在 5 秒内启动');
}

test('占位密码（.env.example 里那类值）拒绝启动', async () => {
  const { child, stderr } = startRaw({ PANEL_PASSWORD: 'change-me-please' });
  assert.equal(await exitCode(child), 1);
  assert.match(stderr(), /占位密码/);
  child.kill();
});

test('ALICE_API_BASE 是明文 http 且指向外部主机：拒绝启动，不把凭据发出去', async () => {
  const { child, stderr } = startRaw({ PANEL_PASSWORD: GOOD_PASSWORD, ALICE_API_BASE: 'http://alice.example/api' });
  assert.equal(await exitCode(child), 1);
  assert.match(stderr(), /ALICE_API_BASE/);
  child.kill();
});

test('ALICE_API_BASE 带账号口令：拒绝启动', async () => {
  const { child, stderr } = startRaw({ PANEL_PASSWORD: GOOD_PASSWORD, ALICE_API_BASE: 'https://user:pass@alice.example/api' });
  assert.equal(await exitCode(child), 1);
  assert.match(stderr(), /账号口令/);
  child.kill();
});

test('超过上限的请求体返回 413，而不是把连接掐断', async (t) => {
  const base = await startPanel(t);
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
    body: JSON.stringify({ password: 'x'.repeat(8000) }),
  });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /过大/);
});

test('响应头带 HSTS（浏览器经反代收到时才生效）', async (t) => {
  const base = await startPanel(t);
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.headers.get('strict-transport-security'), 'max-age=31536000');
});
