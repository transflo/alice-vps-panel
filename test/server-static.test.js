'use strict';

// 启动真实的 server.js，用临时的 PUBLIC_DIR 验证静态文件：HTML 的 CSP 带上内联脚本的哈希，其余响应不放宽。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');
const sha = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

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

async function startPanel(t, publicFiles) {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-public-'));
  for (const [rel, body] of Object.entries(publicFiles)) {
    fs.mkdirSync(path.dirname(path.join(publicDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(publicDir, rel), body);
  }
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PANEL_PASSWORD: 'correct-password',
      HOST: '127.0.0.1',
      PORT: String(port),
      ALICE_CLIENT_ID: 'x',
      ALICE_SECRET: 'y',
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'alice-data-')),
      PUBLIC_DIR: publicDir,
    },
    stdio: 'ignore',
  });
  t.after(() => child.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      /* 还没启动完 */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return base;
}

const INDEX = '<!doctype html><script>boot(1)</script><script src="/_next/static/app.js"></script><script>self.__next_f.push([0])</script>';

test('HTML：CSP 的 script-src 带上该页面全部内联脚本的哈希，且不含 unsafe-inline', async (t) => {
  const base = await startPanel(t, { 'index.html': INDEX, '_next/static/app.js': 'console.log(1)' });
  for (const p of ['/', '/index.html']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200);
    const scriptSrc = res.headers.get('content-security-policy').match(/script-src[^;]*/)[0];
    assert.equal(scriptSrc, `script-src 'self' ${sha('boot(1)')} ${sha('self.__next_f.push([0])')}`);
  }
});

test('每个 HTML 页面只带自己的哈希', async (t) => {
  const base = await startPanel(t, { 'index.html': '<script>a()</script>', '404.html': '<script>b()</script>' });
  const a = (await fetch(`${base}/index.html`)).headers.get('content-security-policy');
  const b = (await fetch(`${base}/404.html`)).headers.get('content-security-policy');
  assert.ok(a.includes(sha('a()')) && !a.includes(sha('b()')));
  assert.ok(b.includes(sha('b()')) && !b.includes(sha('a()')));
});

test('JS 等静态文件和接口响应：script-src 仍然只有 self；/_next/static/ 下的文件长期缓存', async (t) => {
  const base = await startPanel(t, { 'index.html': INDEX, '_next/static/app.js': 'console.log(1)' });
  const js = await fetch(`${base}/_next/static/app.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.match(js.headers.get('content-security-policy'), /script-src 'self'(;|$)/);
  const api = await fetch(`${base}/api/session`);
  assert.match(api.headers.get('content-security-policy'), /script-src 'self'(;|$)/);
  assert.doesNotMatch(api.headers.get('content-security-policy'), /sha256/);
});

test('HTML 不长期缓存（每次向服务器确认）', async (t) => {
  const base = await startPanel(t, { 'index.html': INDEX });
  assert.equal((await fetch(`${base}/`)).headers.get('cache-control'), 'no-cache');
});
