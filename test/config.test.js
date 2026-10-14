'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../config');

const load = (env) => {
  const warnings = [];
  return { cfg: loadConfig(env, (m) => warnings.push(m)), warnings };
};

test('默认值', () => {
  const { cfg, warnings } = load({});
  assert.equal(cfg.renewBeforeMinutes, 60);
  assert.equal(cfg.renewRetryMinutes, 10);
  assert.equal(cfg.intervalSeconds, 60);
  assert.equal(cfg.displayTimeZone, 'Asia/Shanghai');
  assert.equal(cfg.dataDir, path.join(__dirname, '..', 'data'));
  assert.equal(cfg.telegram.enabled, false);
  assert.equal(cfg.telegram.apiBase, 'https://api.telegram.org');
  assert.deepEqual(warnings, []);
});

test('非法数值回退默认并警告', () => {
  const { cfg, warnings } = load({ AUTO_RENEW_BEFORE_MINUTES: 'abc', AUTO_RENEW_INTERVAL_SECONDS: '0' });
  assert.equal(cfg.renewBeforeMinutes, 60);
  assert.equal(cfg.intervalSeconds, 60);
  assert.equal(warnings.length, 2);
});

test('AUTO_RENEW_RETRY_MINUTES：1 ~ 60 的整数，非法回退 10 并警告', () => {
  assert.equal(load({ AUTO_RENEW_RETRY_MINUTES: '5' }).cfg.renewRetryMinutes, 5);
  const { cfg, warnings } = load({ AUTO_RENEW_RETRY_MINUTES: '0' });
  assert.equal(cfg.renewRetryMinutes, 10);
  assert.equal(warnings.length, 1);
});

test('DATA_DIR 和 DISPLAY_TIME_ZONE；非法时区回退并警告', () => {
  assert.equal(load({ DATA_DIR: '/data' }).cfg.dataDir, '/data');
  assert.equal(load({ DISPLAY_TIME_ZONE: 'America/New_York' }).cfg.displayTimeZone, 'America/New_York');
  const { cfg, warnings } = load({ DISPLAY_TIME_ZONE: 'Mars/Base' });
  assert.equal(cfg.displayTimeZone, 'Asia/Shanghai');
  assert.equal(warnings.length, 1);
});

test('Telegram：token + 数字 ID 才启用；ID 里混入非数字会被忽略并警告', () => {
  const { cfg, warnings } = load({ TELEGRAM_BOT_TOKEN: ' 123:abc ', TELEGRAM_ALLOWED_USER_IDS: '42, 43 @someone' });
  assert.equal(cfg.telegram.enabled, true);
  assert.equal(cfg.telegram.token, '123:abc');
  assert.deepEqual(cfg.telegram.allowedIds, ['42', '43']);
  assert.equal(warnings.length, 1);
});

test('Telegram：设置了 token 但没有有效的用户 ID → 不启用并给出错误（失败默认关闭）', () => {
  for (const ids of [undefined, '', '@someone']) {
    const t = load({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_ALLOWED_USER_IDS: ids }).cfg.telegram;
    assert.equal(t.enabled, false);
    assert.match(t.error, /TELEGRAM_ALLOWED_USER_IDS/);
  }
});

test('Telegram：只有用户 ID 没有 token → 不启用，也没有错误', () => {
  const t = load({ TELEGRAM_ALLOWED_USER_IDS: '42' }).cfg.telegram;
  assert.equal(t.enabled, false);
  assert.equal(t.error, undefined);
});

test('TELEGRAM_API_BASE：归一成 origin；非官方地址一律回退默认', () => {
  assert.equal(load({ TELEGRAM_API_BASE: 'https://api.telegram.org//' }).cfg.telegram.apiBase, 'https://api.telegram.org');
  // 只认官方地址（回环地址另有显式开关）：换成别的主机就退回默认，
  // 否则面板会把 bot token 发到那台机器上
  assert.equal(load({ TELEGRAM_API_BASE: 'https://tg.example.com' }).cfg.telegram.apiBase, 'https://api.telegram.org');
});
