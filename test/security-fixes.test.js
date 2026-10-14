'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../store');
const { loadConfig } = require('../config');
const { buildCsp, BASE_DIRECTIVES } = require('../csp');
const N = require('../normalize');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-sec-'));
const silent = { warn() {}, error() {}, log() {} };

test('store：拒绝 __proto__/constructor/prototype，不污染原型', () => {
  const store = createStore({ dir: tmpDir(), log: silent });
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => store.setAutoRenew(bad, { enabled: true, hours: 24 }), /无效的实例 ID/);
    assert.throws(() => store.updateCycle(bad, { warnedFor: 'x' }), /无效的实例 ID/);
    assert.throws(() => store.getAutoRenew(bad), /无效的实例 ID/);
  }
  assert.equal({}.polluted, undefined);
  assert.ok(!Object.hasOwn(store.listAutoRenew(), '__proto__'));
});

test('store：从文件中读到 __proto__ 键时忽略', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, autoRenew: { __proto__: { enabled: true }, 1001: { enabled: true, hours: 24 } }, cycle: {} }));
  const store = createStore({ dir, log: silent });
  assert.deepEqual(store.listAutoRenew(), { 1001: { enabled: true, hours: 24 } });
  assert.equal({}.polluted, undefined);
});

test('config：TELEGRAM_API_BASE 非 https/带账号口令时回退默认并警告', () => {
  const warns = [];
  const warn = (m) => warns.push(m);
  let c = loadConfig({ TELEGRAM_API_BASE: 'http://attacker.example/api', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOWED_USER_IDS: '42' }, warn);
  assert.equal(c.telegram.apiBase, 'https://api.telegram.org');
  assert.ok(warns.some((m) => /TELEGRAM_API_BASE/.test(m)));

  warns.length = 0;
  c = loadConfig({ TELEGRAM_API_BASE: 'https://user:pass@api.telegram.org', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOWED_USER_IDS: '42' }, warn);
  assert.equal(c.telegram.apiBase, 'https://api.telegram.org');

  // 本地回环 http 只在显式开关下放行（本机测试用的假 Telegram 服务器）
  process.env.TELEGRAM_API_BASE_ALLOW_LOOPBACK = '1';
  try {
    c = loadConfig({ TELEGRAM_API_BASE: 'http://127.0.0.1:8080', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOWED_USER_IDS: '42' }, warn);
    assert.equal(c.telegram.apiBase, 'http://127.0.0.1:8080');
  } finally {
    delete process.env.TELEGRAM_API_BASE_ALLOW_LOOPBACK;
  }
  // 开关关掉后回环也要拒绝
  c = loadConfig({ TELEGRAM_API_BASE: 'http://127.0.0.1:8080', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ALLOWED_USER_IDS: '42' }, warn);
  assert.equal(c.telegram.apiBase, 'https://api.telegram.org');
});

test('csp：默认包含 object-src none，且 script-src 无 unsafe-inline', () => {
  assert.ok(BASE_DIRECTIVES.includes("object-src 'none'"));
  const csp = buildCsp([]);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline/);
  // style-src 的 unsafe-inline 是 Sonner 必需，保留
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
});

test('decodeOutput：OSC 以 ST 结尾的超链接被清除', () => {
  const oscSt = 'hello\x1b]8;;http://evil\x1b\\world';
  assert.equal(N.decodeOutput(oscSt), 'helloworld');
  const csi = '\x1b[32mgreen\x1b[0m';
  assert.equal(N.decodeOutput(csi), 'green');
});

test('decodeOutput：超大输入直接截断，不做 Base64 解码', () => {
  const big = 'A'.repeat(2 * 1024 * 1024);
  const out = N.decodeOutput(big);
  assert.ok(out.length <= 256 * 1024);
});
