'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const n = require('../normalize');

test('normInstance：取常见字段，到期 / 创建时间只读 *_at_utc', () => {
  const raw = {
    id: 1001,
    hostname: 'vm-a',
    status: 'active',
    ipv4: [{ address: '203.0.113.7' }],
    plan_id: 38,
    expiration_at: '2026-10-01T20:38:55+01:00',
    expiration_at_utc: '2026-10-01T19:38:55.000Z',
    creation_at_utc: '2026-09-30T19:38:55.000Z',
  };
  const i = n.normInstance(raw);
  assert.equal(i.id, '1001');
  assert.equal(i.name, 'vm-a');
  assert.equal(i.status, 'active');
  assert.equal(i.ipv4, '203.0.113.7');
  assert.equal(i.planId, '38');
  assert.equal(i.expiresAt, Date.parse('2026-10-01T19:38:55.000Z'));
  assert.equal(i.createdAt, Date.parse('2026-09-30T19:38:55.000Z'));
});

test('normInstance：没有规范化时间 / 乱码时间 → null', () => {
  assert.equal(n.normInstance({ id: 1, expiration_at: '2026-10-01T20:38:55+01:00' }).expiresAt, null);
  assert.equal(n.normInstance({ id: 1, expiration_at_utc: 'garbage' }).expiresAt, null);
  assert.equal(n.normInstance({}).id, '');
});

test('asList：数组、{list}、其他对象里的第一个数组', () => {
  assert.deepEqual(n.asList([1]), [1]);
  assert.deepEqual(n.asList({ list: [2] }), [2]);
  assert.deepEqual(n.asList({ foo: [3] }), [3]);
  assert.deepEqual(n.asList(null), []);
});

test('powerState / cardStatus', () => {
  assert.equal(n.powerState({ status: 'complete', state: { state: 'running' } }), 'running');
  assert.equal(n.powerState({}), undefined);
  assert.equal(n.cardStatus({ status: 'active' }, 'running'), 'running');
  assert.equal(n.cardStatus({ status: 'expired' }, 'running'), 'expired');
});

test('statusLabel：中文标签，未知值原样返回', () => {
  assert.equal(n.statusLabel('running'), '运行中');
  assert.equal(n.statusLabel('stopped'), '已关机');
  assert.equal(n.statusLabel('weird'), 'weird');
  assert.equal(n.statusLabel(undefined), '未知');
});

test('套餐：按 allow_packages 过滤，无库存的不可选，max_time 限制时长', () => {
  const plans = n.normPlans([
    { id: 38, name: 'A', cpu: 1, memory: 1, disk: 10, stock: 3 },
    { id: 39, name: 'B', stock: 0 },
    { id: 40, name: 'C', stock: 5 },
  ]);
  const opts = n.planOptions(plans, { allow_packages: '38|39' });
  assert.deepEqual(opts.map((o) => [o.id, o.disabled]), [['38', false], ['39', true]]);
  assert.match(opts[0].label, /A（1 核 · 1 GB 内存 · 10 GB 磁盘，库存 3）/);
  assert.equal(n.maxHours({ max_time: '48' }), 48);
  assert.equal(n.maxHours({}), null);
  assert.deepEqual(n.durationOptions(48), [1, 2, 4, 8, 12, 24, 48]);
  assert.deepEqual(n.durationOptions(null).at(-1), 168);
  assert.equal(n.durationLabel(24), '24 小时（1 天）');
});

test('权限格式不认识时不要把套餐全部藏掉', () => {
  const plans = n.normPlans([{ id: 38, name: 'A' }]);
  assert.equal(n.planOptions(plans, { allow_packages: '99' }).length, 1);
});

test('flattenImages：分组嵌套展开，按 group_id 排序', () => {
  const data = [
    { group_id: 2, group_name: 'Debian', os_list: [{ id: 201, name: 'Debian 12' }] },
    { group_id: 1, group_name: 'Ubuntu', os_list: [{ id: 101, name: 'Ubuntu 24.04' }, { id: 102, name: 'Ubuntu 22.04' }] },
  ];
  assert.deepEqual(n.flattenImages(data), [
    { id: '101', name: 'Ubuntu 24.04', group: 'Ubuntu' },
    { id: '102', name: 'Ubuntu 22.04', group: 'Ubuntu' },
    { id: '201', name: 'Debian 12', group: 'Debian' },
  ]);
});

test('normSshKeys', () => {
  assert.deepEqual(n.normSshKeys([{ id: 5, name: 'laptop' }, { name: 'no-id' }]), [{ id: '5', name: 'laptop' }]);
});

test('decodeOutput：Base64 解码、去掉 ANSI 颜色；不是 Base64 就原样显示', () => {
  const b64 = Buffer.from('\x1b[32mhello\x1b[0m 世界\n').toString('base64');
  assert.equal(n.decodeOutput(b64), 'hello 世界\n');
  assert.equal(n.decodeOutput('plain text'), 'plain text');
});

test('RUNNING_RE', () => {
  assert.ok(n.RUNNING_RE.test('running'));
  assert.ok(n.RUNNING_RE.test('pending'));
  assert.ok(!n.RUNNING_RE.test('complete'));
});
