'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../store');

const silent = { warn() {}, error() {}, log() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-store-'));

test('设置自动续期并持久化：重新打开后仍然存在，且不留临时文件', () => {
  const dir = tmp();
  const a = createStore({ dir, log: silent });
  assert.equal(a.available, true);
  a.setAutoRenew('1001', { enabled: true, hours: 24 });
  assert.deepEqual(a.getAutoRenew('1001'), { enabled: true, hours: 24 });
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);

  const b = createStore({ dir, log: silent });
  assert.deepEqual(b.listAutoRenew(), { 1001: { enabled: true, hours: 24 } });
});

test('关闭后保留 hours；removeInstance 同时清理设置和周期记录', () => {
  const s = createStore({ dir: tmp(), log: silent });
  s.setAutoRenew('1', { enabled: true, hours: 12 });
  s.setAutoRenew('1', { enabled: false, hours: 12 });
  assert.deepEqual(s.getAutoRenew('1'), { enabled: false, hours: 12 });
  s.updateCycle('1', { renewedFrom: 'x' });
  s.removeInstance('1');
  assert.equal(s.getAutoRenew('1'), undefined);
  assert.deepEqual(s.getCycle('1'), {});
});

test('周期记录：合并更新，返回副本', () => {
  const s = createStore({ dir: tmp(), log: silent });
  s.updateCycle('1', { renewedFrom: 'a' });
  s.updateCycle('1', { attemptFor: 'b', attempts: 2, lastAttemptAt: 123 });
  const c = s.getCycle('1');
  assert.deepEqual(c, { renewedFrom: 'a', attemptFor: 'b', attempts: 2, lastAttemptAt: 123 });
  c.renewedFrom = 'changed';
  assert.equal(s.getCycle('1').renewedFrom, 'a');
});

test('重新保存自动续期设置会清掉失败重试的计数（让用户充值后可以再试），但保留已续期标记', () => {
  const s = createStore({ dir: tmp(), log: silent });
  s.setAutoRenew('1', { enabled: true, hours: 24 });
  s.updateCycle('1', { renewedFrom: 'r', warnedFor: 'w', attemptFor: 'k', attempts: 3, lastAttemptAt: 99 });
  s.setAutoRenew('1', { enabled: true, hours: 12 });
  assert.deepEqual(s.getCycle('1'), { renewedFrom: 'r', warnedFor: 'w' });
});

test('状态文件损坏：改名为 .bak，从空状态启动，不抛错', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'state.json'), '{ not json');
  const warnings = [];
  const s = createStore({ dir, log: { ...silent, warn: (m) => warnings.push(m) } });
  assert.deepEqual(s.listAutoRenew(), {});
  assert.ok(fs.existsSync(path.join(dir, 'state.json.bak')));
  assert.equal(warnings.length > 0, true);
  s.setAutoRenew('1', { enabled: true, hours: 1 }); // 之后仍可正常写入
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).autoRenew['1'].enabled, true);
});

test('数据目录不可写：available=false，设置自动续期返回 503，周期记录仍可在内存里使用', () => {
  const file = path.join(tmp(), 'iam-a-file');
  fs.writeFileSync(file, 'x');
  const s = createStore({ dir: path.join(file, 'sub'), log: silent }); // 目录建在文件下面，必然失败
  assert.equal(s.available, false);
  assert.throws(() => s.setAutoRenew('1', { enabled: true, hours: 24 }), (e) => e.status === 503);
  s.updateCycle('1', { warnedFor: 'x' });
  assert.equal(s.getCycle('1').warnedFor, 'x');
  assert.deepEqual(s.listAutoRenew(), {});
});

test('touch：存在的条目保持，超过 7 天没出现的条目被清理', () => {
  let now = Date.parse('2026-10-01T00:00:00Z');
  const s = createStore({ dir: tmp(), now: () => now, log: silent });
  s.setAutoRenew('1', { enabled: true, hours: 24 });
  s.setAutoRenew('2', { enabled: true, hours: 24 });
  s.updateCycle('2', { warnedFor: 'x' });
  now += 6 * 24 * 3600e3;
  s.touch(['1']);
  assert.ok(s.getAutoRenew('1') && s.getAutoRenew('2'));
  now += 2 * 24 * 3600e3; // 实例 2 已经 8 天没出现
  s.touch(['1']);
  assert.ok(s.getAutoRenew('1'));
  assert.equal(s.getAutoRenew('2'), undefined);
  assert.deepEqual(s.getCycle('2'), {});
});

test('touch：1 小时内不重复写盘', () => {
  const dir = tmp();
  let now = Date.parse('2026-10-01T00:00:00Z');
  const s = createStore({ dir, now: () => now, log: silent });
  s.setAutoRenew('1', { enabled: true, hours: 24 });
  s.touch(['1']);
  const file = path.join(dir, 'state.json');
  fs.unlinkSync(file); // 如果 touch 又写盘，文件会重新出现
  now += 60e3;
  s.touch(['1']);
  assert.equal(fs.existsSync(file), false);
  now += 2 * 3600e3; // 超过 1 小时才会刷新 lastSeen 并写盘
  s.touch(['1']);
  assert.equal(fs.existsSync(file), true);
});
