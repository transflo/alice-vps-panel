'use strict';

// 启动真实的 server.js + 假 Alice，只通过 HTTP 验证：时间规范化、自动续期接口、持久化、调度器续期、删除清理。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { startMockAlice, makeInstance, HOUR } = require('./helpers/mock-alice');

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

async function startPanel(t, { alice, dataDir, env = {} }) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PANEL_PASSWORD: 'correct-password',
      HOST: '127.0.0.1',
      PORT: String(port),
      ALICE_API_BASE: alice.base,
      ALICE_CLIENT_ID: 'cli_test',
      ALICE_SECRET: 'secret',
      DATA_DIR: dataDir,
      AUTO_RENEW_INTERVAL_SECONDS: '1',
      ...env,
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
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
    body: JSON.stringify({ password: 'correct-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = async (method, p, body, headers = {}) => {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Panel': '1', Cookie: cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { base, call };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-int-'));
const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

test('GET /api/instances：追加规范化时间，原始字段保持不变', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const created = Date.parse('2026-09-30T19:38:55Z');
  alice.instances.push(makeInstance(1001, { createdMs: created, expiresMs: created + 24 * HOUR }));
  const { call } = await startPanel(t, { alice, dataDir: tmpDir() });

  const r = await call('GET', '/api/instances');
  const inst = r.json.data[0];
  assert.equal(inst.creation_at, '2026-10-01T03:38:55+01:00'); // 原始值（偏移标签有误）原样保留
  assert.equal(inst.creation_at_utc, '2026-09-30T19:38:55.000Z');
  assert.equal(inst.expiration_at_utc, '2026-10-01T19:38:55.000Z');
});

test('自动续期接口：默认关闭、校验参数、持久化', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const dir = tmpDir();
  const { call } = await startPanel(t, { alice, dataDir: dir });

  // policy 告诉网页：到期前多久开始、最多尝试几次、两次之间隔多久（用于弹窗文案）
  assert.deepEqual((await call('GET', '/api/auto-renew')).json.data, {
    available: true,
    items: {},
    policy: { beforeMinutes: 60, maxAttempts: 3, retryMinutes: 10 },
  });

  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 0 })).status, 400);
  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: 'yes', hours: 24 })).status, 400);
  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: true })).status, 400);
  assert.equal((await call('POST', '/api/instances/a%20b/auto-renew', { enabled: true, hours: 24 })).status, 404);
  // 缺少 X-Panel 头（CSRF 防护）
  assert.equal((await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 }, { 'X-Panel': '' })).status, 403);

  const on = await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  assert.deepEqual(on.json.data, { enabled: true, hours: 24 });
  assert.deepEqual((await call('GET', '/api/auto-renew')).json.data.items, { 1001: { enabled: true, hours: 24 } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).autoRenew['1001'].enabled, true);

  const off = await call('POST', '/api/instances/1001/auto-renew', { enabled: false });
  assert.deepEqual(off.json.data, { enabled: false, hours: 24 }); // 关闭时保留之前的时长
});

test('数据目录不可写：available=false，开启自动续期返回 503，面板其余功能正常', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const file = path.join(tmpDir(), 'iam-a-file');
  fs.writeFileSync(file, 'x');
  const { call } = await startPanel(t, { alice, dataDir: path.join(file, 'sub') });

  assert.equal((await call('GET', '/api/auto-renew')).json.data.available, false);
  const r = await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /DATA_DIR/);
  assert.equal((await call('GET', '/api/instances')).status, 200);
});

test('调度器：开启自动续期的实例进入窗口后被续期一次，之后不会重复续期', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const now = Date.now();
  alice.instances.push(makeInstance(1001, { createdMs: now - 23 * HOUR, expiresMs: now + 5 * 60e3 })); // 5 分钟后到期
  alice.instances.push(makeInstance(1002, { createdMs: now - 23 * HOUR, expiresMs: now + 5 * 60e3 })); // 没开自动续期
  const { call } = await startPanel(t, { alice, dataDir: tmpDir() });

  await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  const renewals = () => alice.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/renewals'));
  assert.equal(await waitFor(() => renewals().length >= 1), true, '应该发起续期');
  await new Promise((r) => setTimeout(r, 3500)); // 再跑几轮
  assert.deepEqual(renewals().map((c) => [c.path, c.body]), [['/evo/instances/1001/renewals', { time: 24 }]]);
});

test('删除实例后清理它的自动续期设置', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const now = Date.now();
  alice.instances.push(makeInstance(1001, { createdMs: now, expiresMs: now + 24 * HOUR }));
  const { call } = await startPanel(t, { alice, dataDir: tmpDir() });

  await call('POST', '/api/instances/1001/auto-renew', { enabled: true, hours: 24 });
  assert.equal((await call('DELETE', '/api/instances/1001')).status, 200);
  assert.deepEqual((await call('GET', '/api/auto-renew')).json.data.items, {});
});
