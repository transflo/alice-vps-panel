'use strict';

// 真实 server.js + 假 Telegram：网页端配置 bot 的端到端测试（保存/校验/热启停/环境变量优先）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { startMockAlice } = require('./helpers/mock-alice');
const { startFakeTelegram } = require('./helpers/fake-telegram-http');

const SERVER = path.join(__dirname, '..', 'server.js');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-tgweb-'));

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
      AUTO_RENEW_INTERVAL_SECONDS: '600',
      // 测试用假 Telegram（回环地址）：正式环境只允许 https://api.telegram.org，这里显式放行回环
      TELEGRAM_API_BASE_ALLOW_LOOPBACK: '1',
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
  return { call };
}

const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

test('网页端配置全流程：查看 → 校验 → 保存热启动 → 问候消息 → 停用', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const dir = tmpDir();
  const { call } = await startPanel(t, { alice, dataDir: dir });

  const empty = await call('GET', '/api/telegram-config');
  assert.equal(empty.json.data.source, null);
  assert.equal(empty.json.data.enabled, false);

  // 非法用户 ID
  assert.equal((await call('POST', '/api/telegram-config', { enabled: true, token: '123:abc', allowedIds: 'nope' })).status, 400);
  // 缺 token
  assert.equal((await call('POST', '/api/telegram-config', { enabled: true, token: '', allowedIds: '42' })).status, 400);

  // 正常保存：token 不回显，bot 启动并发出问候
  const saved = await call('POST', '/api/telegram-config', { enabled: true, token: '123:abc', allowedIds: '42, 43', apiBase: tg.base });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.data.enabled, true);
  assert.equal(saved.json.data.source, 'file');
  assert.deepEqual(saved.json.data.allowedIds, ['42', '43']);
  assert.equal(saved.json.data.hasToken, true);
  assert.match(saved.json.data.tokenHint, /^123:\*\*\*$/);
  assert.ok(!JSON.stringify(saved.json).includes('123:abc'), '完整 token 不能出现在响应里');
  assert.ok(fs.existsSync(path.join(dir, 'telegram.json')));
  assert.equal(await waitFor(() => tg.messages.some((m) => m.chat_id === 42 && /通知已启用/.test(m.text))), true, '白名单用户应收到问候消息');

  const after = await call('GET', '/api/telegram-config');
  assert.equal(after.json.data.running, true);

  // 只改用户 ID（token 留空沿用）：bot 重启，新 ID 收到问候
  const kept = await call('POST', '/api/telegram-config', { enabled: true, token: '', allowedIds: '44', apiBase: tg.base });
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.json.data.allowedIds, ['44']);
  assert.equal(await waitFor(() => tg.messages.some((m) => m.chat_id === 44 && /通知已启用/.test(m.text))), true);

  // 停用：配置清除，bot 停止
  const off = await call('POST', '/api/telegram-config', { enabled: false });
  assert.equal(off.status, 200);
  assert.equal(off.json.data.enabled, false);
  assert.equal(fs.existsSync(path.join(dir, 'telegram.json')), false);
});

test('token 连不上 Telegram 时不碰正在跑的 bot', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const dir = tmpDir();
  const { call } = await startPanel(t, { alice, dataDir: dir });

  await call('POST', '/api/telegram-config', { enabled: true, token: '123:abc', allowedIds: '42', apiBase: tg.base });
  assert.equal(await waitFor(() => tg.messages.some((m) => m.chat_id === 42 && /通知已启用/.test(m.text))), true);
  const n = tg.messages.length;
  const bad = await call('POST', '/api/telegram-config', { enabled: true, token: '123:abc', allowedIds: '42', apiBase: 'http://127.0.0.1:1' });
  assert.equal(bad.status, 502);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(tg.messages.length, n, '验证失败不应重启 bot（没有新的问候消息）');
  assert.equal((await call('GET', '/api/telegram-config')).json.data.running, true);
});

test('.env 配了 token 时网页端只读（409）', async (t) => {
  const alice = await startMockAlice();
  t.after(() => alice.close());
  const tg = await startFakeTelegram();
  t.after(() => tg.close());
  const { call } = await startPanel(t, {
    alice,
    dataDir: tmpDir(),
    env: { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_ALLOWED_USER_IDS: '42', TELEGRAM_API_BASE: tg.base },
  });
  const view = await call('GET', '/api/telegram-config');
  assert.equal(view.json.data.source, 'env');
  assert.equal(view.json.data.managedByEnv, true);
  assert.equal((await call('POST', '/api/telegram-config', { enabled: false })).status, 409);
});
