'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../telegram-config');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-tgcfg-'));

test('parseAllowedIds：逗号/空格分隔、去重，非法直接报错', () => {
  assert.deepEqual(T.parseAllowedIds('42, 43 42'), ['42', '43']);
  assert.deepEqual(T.parseAllowedIds(['42', '43']), ['42', '43']);
  assert.throws(() => T.parseAllowedIds(''), /至少填写/);
  assert.throws(() => T.parseAllowedIds('abc'), /无效/);
  assert.throws(() => T.parseAllowedIds('1234567890123456'), /无效/);
});

test('parseToken / parseApiBase', () => {
  assert.equal(T.parseToken(' 123:abc '), '123:abc');
  assert.throws(() => T.parseToken(' '), /填写/);
  assert.equal(T.parseApiBase(''), 'https://api.telegram.org');
  assert.equal(T.parseApiBase('https://api.telegram.org/'), 'https://api.telegram.org');
  // 只认官方地址：换任何别的主机都拒绝，否则面板会把 bot token 发到那台机器上（SSRF / token 外泄）
  assert.throws(() => T.parseApiBase('https://example.com/'), /api\.telegram\.org/);
  assert.throws(() => T.parseApiBase('https://api.telegram.org:8443'), /端口/);
  assert.throws(() => T.parseApiBase('http://attacker.example'), /https/);
  assert.throws(() => T.parseApiBase('https://user:pass@example.com'), /口令/);
  assert.throws(() => T.parseApiBase('::::'), /无效/);
  // 回环地址默认也拒绝（fake server 只在显式开关下放行）
  assert.throws(() => T.parseApiBase('http://127.0.0.1:8080'), /https/);
  process.env.TELEGRAM_API_BASE_ALLOW_LOOPBACK = '1';
  try {
    assert.equal(T.parseApiBase('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.equal(T.parseApiBase('http://localhost:8080/api'), 'http://localhost:8080');
    // 开了开关也只放行回环，别的地址照样拒绝
    assert.throws(() => T.parseApiBase('http://example.com'), /https/);
    assert.throws(() => T.parseApiBase('https://example.com'), /api\.telegram\.org/);
  } finally {
    delete process.env.TELEGRAM_API_BASE_ALLOW_LOOPBACK;
  }
  assert.throws(() => T.parseApiBase('http://127.0.0.1:8080'), /https/, '开关关掉后回环也要拒绝');
});

test('maskToken：只留 bot id 部分', () => {
  assert.equal(T.maskToken('123456:ABCdef'), '123456:***');
  assert.equal(T.maskToken(''), '***');
});

test('存取往返；文件缺失/损坏返回 null；清除删除文件', () => {
  const dir = tmpDir();
  assert.equal(T.readTelegramConfig(dir), null);
  T.saveTelegramConfig(dir, { token: 't', allowedIds: ['42'], apiBase: 'https://api.telegram.org' });
  assert.deepEqual(T.readTelegramConfig(dir), { token: 't', allowedIds: ['42'], apiBase: 'https://api.telegram.org' });
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(dir, 'telegram.json')).mode & 0o777, 0o600);
  }
  fs.writeFileSync(path.join(dir, 'telegram.json'), '{broken');
  assert.equal(T.readTelegramConfig(dir), null);
  T.saveTelegramConfig(dir, { token: 't', allowedIds: ['42'], apiBase: 'https://x' });
  T.clearTelegramConfig(dir);
  assert.equal(T.readTelegramConfig(dir), null);
});
