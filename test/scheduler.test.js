'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../store');
const { createScheduler, decide } = require('../scheduler');

const silent = { warn() {}, error() {}, log() {} };
const NOW = Date.parse('2026-10-01T12:00:00Z');
const MIN = 60e3;
const cfg = { renewBeforeMs: 60 * MIN, retryGapMs: 10 * MIN, warnBeforeMs: 30 * MIN, botEnabled: true, intervalMs: 60e3 };
const inst = (minLeft, status = 'active') => ({ id: '1', status, expiresAt: NOW + minLeft * MIN });
const on = { enabled: true, hours: 24 };
const off = { enabled: false, hours: 24 };
const D = (args) => decide({ now: NOW, cfg, cycle: {}, ...args });

test('decide：已开启自动续期，剩余时间进入窗口才续期', () => {
  assert.equal(D({ entry: on, inst: inst(61) }), 'none');
  assert.equal(D({ entry: on, inst: inst(60) }), 'renew');
  assert.equal(D({ entry: on, inst: inst(1) }), 'renew');
});

test('decide：失败后要等间隔才重试，最多 3 次，之后这个到期点不再尝试', () => {
  const i = inst(50);
  const key = new Date(i.expiresAt).toISOString();
  const tried = (attempts, agoMin) => ({ attemptFor: key, attempts, lastAttemptAt: NOW - agoMin * MIN });
  assert.equal(D({ entry: on, inst: i, cycle: tried(1, 9) }), 'none', '间隔没到');
  assert.equal(D({ entry: on, inst: i, cycle: tried(1, 10) }), 'renew', '第 2 次');
  assert.equal(D({ entry: on, inst: i, cycle: tried(2, 10) }), 'renew', '第 3 次');
  assert.equal(D({ entry: on, inst: i, cycle: tried(3, 600) }), 'none', '已经试满 3 次');
  // 计数属于某一个到期点：到期时间变了（比如用户手动续期过），重新开始
  assert.equal(D({ entry: on, inst: i, cycle: { attemptFor: '2020-01-01T00:00:00.000Z', attempts: 3, lastAttemptAt: NOW } }), 'renew');
});

test('decide：已到期、实例状态为 expired、没有到期时间 → 不处理', () => {
  assert.equal(D({ entry: on, inst: inst(0) }), 'none');
  assert.equal(D({ entry: on, inst: inst(-5) }), 'none');
  assert.equal(D({ entry: on, inst: inst(5, 'expired') }), 'none');
  assert.equal(D({ entry: on, inst: { id: '1', status: 'active', expiresAt: null } }), 'none');
});

test('decide：这个到期点已经续过 → 不重复续', () => {
  const i = inst(5);
  const cycle = { renewedFrom: new Date(i.expiresAt).toISOString() };
  assert.equal(D({ entry: on, inst: i, cycle }), 'none');
  // 到期时间变了（续期成功后），又是新的周期
  assert.equal(D({ entry: on, inst: inst(5), cycle: { renewedFrom: '2020-01-01T00:00:00.000Z' } }), 'renew');
});

test('decide：未开启自动续期 → 只在 bot 启用且进入提醒窗口时 warn，每个到期点一次', () => {
  for (const entry of [undefined, off]) {
    assert.equal(D({ entry, inst: inst(31) }), 'none');
    assert.equal(D({ entry, inst: inst(30) }), 'warn');
    assert.equal(D({ entry, inst: inst(5) }), 'warn');
  }
  const i = inst(20);
  assert.equal(D({ inst: i, cycle: { warnedFor: new Date(i.expiresAt).toISOString() } }), 'none');
  assert.equal(decide({ now: NOW, inst: inst(20), cfg: { ...cfg, botEnabled: false } }), 'none');
  assert.equal(decide({ now: NOW, inst: inst(20), cfg: { ...cfg, warnBeforeMs: 0 } }), 'none');
});

// ---------- tick ----------

const raw = (minLeft, extra = {}) => ({
  id: 1, hostname: 'vm', status: 'active', expiration_at_utc: new Date(NOW + minLeft * MIN).toISOString(), ...extra,
});

function setup({ instances, renew, autoRenew = { 1: on }, botEnabled = true, listInstances, configured = () => true, clock = { now: NOW } } = {}) {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'alice-sched-')), now: () => clock.now, log: silent });
  for (const [id, e] of Object.entries(autoRenew)) store.setAutoRenew(id, e);
  const calls = { list: 0, renew: [] };
  const events = [];
  const alice = {
    configured,
    listInstances: listInstances || (async () => { calls.list += 1; return instances(); }),
    renew: async (id, hours) => {
      calls.renew.push([id, hours]);
      return renew ? renew(id, hours) : { expiration_at_utc: new Date(NOW + hours * 3600e3).toISOString() };
    },
  };
  const scheduler = createScheduler({
    alice, store, notify: async (e) => { events.push(e); }, cfg: { ...cfg, botEnabled }, now: () => clock.now, log: silent,
  });
  return { scheduler, calls, events, store, clock };
}

test('tick：进入窗口时续期并通知；列表仍是旧到期时间的下一轮不会重复续期', async () => {
  const { scheduler, calls, events } = setup({ instances: () => [raw(5)] });
  await scheduler.tick();
  await scheduler.tick(); // 列表还是旧到期时间（比如 Alice 侧有延迟）
  assert.deepEqual(calls.renew, [['1', 24]]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'renewed');
  assert.equal(events[0].hours, 24);
  assert.equal(events[0].inst.id, '1');
});

test('tick：续期成功后到期时间变长，不再续期', async () => {
  let left = 5;
  const { scheduler, calls } = setup({ instances: () => [raw(left)] });
  await scheduler.tick();
  left = 24 * 60 + 5;
  await scheduler.tick();
  assert.equal(calls.renew.length, 1);
});

test('tick：续期失败：间隔没到不重试，到了才重试，最多 3 次；第 1 次和最后一次失败各通知一次', async () => {
  const { scheduler, calls, events, clock } = setup({
    instances: () => [raw(60)], // 固定的到期点：NOW + 60 分钟
    renew: () => { throw new Error('余额不足'); },
  });
  await scheduler.tick(); // 第 1 次
  clock.now += 5 * MIN;
  await scheduler.tick(); // 才过 5 分钟：不重试
  assert.equal(calls.renew.length, 1);
  clock.now += 5 * MIN;
  await scheduler.tick(); // 满 10 分钟：第 2 次
  assert.equal(calls.renew.length, 2);
  clock.now += 10 * MIN;
  await scheduler.tick(); // 第 3 次
  assert.equal(calls.renew.length, 3);
  for (let i = 0; i < 3; i++) {
    clock.now += 10 * MIN;
    await scheduler.tick(); // 已试满：不再尝试
  }
  assert.equal(calls.renew.length, 3);
  assert.deepEqual(events.map((e) => [e.type, e.attempt, e.maxAttempts, e.final]), [
    ['renew_failed', 1, 3, false],
    ['renew_failed', 3, 3, true],
  ]);
  assert.equal(events[0].error, '余额不足');
});

test('tick：前两次失败、第 3 次成功：通知 失败 → 已续期，之后不再续期', async () => {
  let n = 0;
  const { scheduler, calls, events, clock } = setup({
    instances: () => [raw(60)],
    renew: () => {
      if (++n < 3) throw new Error('Alice 暂时不可用');
      return { expiration_at_utc: new Date(NOW + 24 * 3600e3).toISOString() };
    },
  });
  for (let i = 0; i < 6; i++) {
    await scheduler.tick();
    clock.now += 10 * MIN;
  }
  assert.equal(calls.renew.length, 3);
  assert.deepEqual(events.map((e) => e.type), ['renew_failed', 'renewed']);
  assert.equal(events[0].final, false);
});

test('tick：重新保存自动续期设置后，试满 3 次的实例可以再试', async () => {
  const { scheduler, calls, store, clock } = setup({
    instances: () => [raw(60)],
    renew: () => { throw new Error('余额不足'); },
  });
  for (let i = 0; i < 5; i++) {
    await scheduler.tick();
    clock.now += 10 * MIN;
  }
  assert.equal(calls.renew.length, 3);
  store.setAutoRenew('1', { enabled: true, hours: 24 }); // 用户充值后重新保存设置
  await scheduler.tick();
  assert.equal(calls.renew.length, 4);
});

test('tick：两轮重叠时只执行一轮', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const state = { list: 0 };
  const { scheduler, calls } = setup({
    listInstances: async () => { state.list += 1; await gate; return [raw(5)]; },
  });
  const first = scheduler.tick();
  await scheduler.tick(); // 第一轮还没结束，直接跳过
  release();
  await first;
  assert.equal(state.list, 1);
  assert.equal(calls.renew.length, 1);
});

test('tick：没有开启的自动续期且 bot 未启用时，不调用 Alice', async () => {
  const { scheduler, calls } = setup({ instances: () => [raw(5)], autoRenew: { 1: off }, botEnabled: false });
  await scheduler.tick();
  assert.equal(calls.list, 0);
});

test('tick：bot 启用且未开自动续期的实例进入窗口时提醒一次', async () => {
  const { scheduler, events, calls } = setup({ instances: () => [raw(20)], autoRenew: {} });
  await scheduler.tick();
  await scheduler.tick();
  assert.deepEqual(events.map((e) => e.type), ['expiring']);
  assert.equal(calls.renew.length, 0);
});

test('tick：拉取列表失败、时间字段是乱码，都不抛错也不通知', async () => {
  const a = setup({ listInstances: async () => { throw new Error('网络错误'); } });
  await a.scheduler.tick();
  assert.equal(a.events.length, 0);
  const b = setup({ instances: () => [raw(5, { expiration_at_utc: 'garbage' })] });
  await b.scheduler.tick();
  assert.equal(b.calls.renew.length, 0);
});

test('tick：Alice 未配置凭据时不调用', async () => {
  const { scheduler, calls } = setup({ instances: () => [raw(5)], configured: () => false });
  await scheduler.tick();
  assert.equal(calls.list, 0);
});

test('tick：通知发送失败不影响续期结果和后续实例', async () => {
  const store = createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'alice-sched-')), now: () => NOW, log: silent });
  store.setAutoRenew('1', on);
  store.setAutoRenew('2', on);
  const renewed = [];
  const scheduler = createScheduler({
    alice: {
      configured: () => true,
      listInstances: async () => [raw(5), raw(5, { id: 2 })],
      renew: async (id) => { renewed.push(id); return {}; },
    },
    store,
    notify: async () => { throw new Error('Telegram 不可达'); },
    cfg,
    now: () => NOW,
    log: silent,
  });
  await scheduler.tick();
  assert.deepEqual(renewed, ['1', '2']);
});
