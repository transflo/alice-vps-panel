'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAliceTime, parseClockOffset, withUtcTimes } = require('../alice-time');

// 真实数据（2026-10-01，部署时选了 24 小时）：creation_at 的钟面是 UTC+8 但标签写成 +01:00，expiration_at 自洽。
const CREATION = '2026-10-01T03:38:55+01:00';
const EXPIRATION = '2026-10-01T20:38:55+01:00';

test('creation_at：忽略错误的 +01:00 标签，钟面数字按 +08:00 解释', () => {
  assert.equal(parseAliceTime(CREATION, { ignoreOffset: true }), '2026-09-30T19:38:55.000Z');
});

test('expiration_at：按标签解析', () => {
  assert.equal(parseAliceTime(EXPIRATION), '2026-10-01T19:38:55.000Z');
});

test('回归：规范化后到期时间减创建时间恰好 24 小时', () => {
  const rec = withUtcTimes({ creation_at: CREATION, expiration_at: EXPIRATION }, '+08:00');
  assert.equal(Date.parse(rec.expiration_at_utc) - Date.parse(rec.creation_at_utc), 24 * 3600 * 1000);
});

test('规范化后的创建时间在 UTC+8 显示为 2026-10-01 03:38，到期时间为 2026-10-02 03:38', () => {
  const rec = withUtcTimes({ creation_at: CREATION, expiration_at: EXPIRATION }, '+08:00');
  const show = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16);
  assert.equal(show(rec.creation_at_utc), '2026-10-01 03:38');
  assert.equal(show(rec.expiration_at_utc), '2026-10-02 03:38');
});

test('withUtcTimes 保留原始字段，不改动输入对象', () => {
  const input = { id: 1, creation_at: CREATION, expiration_at: EXPIRATION };
  const out = withUtcTimes(input, '+08:00');
  assert.equal(out.creation_at, CREATION);
  assert.equal(out.expiration_at, EXPIRATION);
  assert.equal(out.id, 1);
  assert.equal(input.creation_at_utc, undefined);
});

test('各种写法：Z、空格分隔、不带标签（到期按 UTC，创建按 clockOffset）', () => {
  assert.equal(parseAliceTime('2026-10-01T19:38:55Z'), '2026-10-01T19:38:55.000Z');
  assert.equal(parseAliceTime('2026-10-01 19:38:55'), '2026-10-01T19:38:55.000Z');
  assert.equal(parseAliceTime('2026-10-01 03:38:55', { ignoreOffset: true }), '2026-09-30T19:38:55.000Z');
  assert.equal(parseAliceTime('2026-10-01 03:38', { ignoreOffset: true, clockOffset: '+09:00' }), '2026-09-30T18:38:00.000Z');
  assert.equal(parseAliceTime('2026-10-01T03:38:55.5+0800'), '2026-09-30T19:38:55.500Z');
});

test('纯数字按 epoch 解析（小于 1e12 视为秒）', () => {
  assert.equal(parseAliceTime(1790000000), new Date(1790000000 * 1000).toISOString());
  assert.equal(parseAliceTime('1790000000000'), new Date(1790000000000).toISOString());
});

test('无法解析的值返回 null 而不是抛错', () => {
  for (const v of [null, undefined, '', 'abc', '2026-13-01T00:00:00Z', '2026-02-30 10:00:00', '2026-10-01T25:00:00Z', {}, [], NaN]) {
    assert.equal(parseAliceTime(v), null, String(JSON.stringify(v)));
  }
});

test('withUtcTimes：解析不了的字段不追加；非对象原样返回', () => {
  const out = withUtcTimes({ creation_at: 'garbage', expiration_at: null }, '+08:00');
  assert.equal('creation_at_utc' in out, false);
  assert.equal('expiration_at_utc' in out, false);
  assert.equal(withUtcTimes(null, '+08:00'), null);
  assert.equal(withUtcTimes('x', '+08:00'), 'x');
  assert.deepEqual(withUtcTimes([1], '+08:00'), [1]);
});

test('parseClockOffset：合法值原样返回，非法值回退默认并警告', () => {
  const warnings = [];
  assert.equal(parseClockOffset(undefined, (m) => warnings.push(m)), '+08:00');
  assert.equal(parseClockOffset('-05:30', (m) => warnings.push(m)), '-05:30');
  assert.equal(warnings.length, 0);
  assert.equal(parseClockOffset('Shanghai', (m) => warnings.push(m)), '+08:00');
  assert.equal(parseClockOffset('+25:00', (m) => warnings.push(m)), '+08:00');
  assert.equal(warnings.length, 2);
});
