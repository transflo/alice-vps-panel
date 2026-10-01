'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HttpError, reqId, optId, hours, optText, POWER_ACTIONS } = require('../validate');

const bad = (fn) => assert.throws(fn, (e) => e instanceof HttpError && e.status === 400);

test('reqId：接受合法 ID（含数字），拒绝空值、空格和特殊字符', () => {
  assert.equal(reqId('abc-1_2', '实例'), 'abc-1_2');
  assert.equal(reqId(1001, '实例'), '1001');
  for (const v of [undefined, null, '', 'a b', 'a/b', '../x', 'x'.repeat(65)]) bad(() => reqId(v, '实例'));
});

test('optId：空值返回 null，其他同 reqId', () => {
  assert.equal(optId(undefined, '密钥'), null);
  assert.equal(optId('', '密钥'), null);
  assert.equal(optId('7', '密钥'), '7');
  bad(() => optId('a b', '密钥'));
});

test('hours：1 ~ 8760 的整数', () => {
  assert.equal(hours('24'), 24);
  assert.equal(hours(8760), 8760);
  for (const v of [0, -1, 1.5, 8761, 'x', undefined, null]) bad(() => hours(v));
});

test('optText：空值返回 undefined，非字符串或过长报错', () => {
  assert.equal(optText('', '命令', 10), undefined);
  assert.equal(optText('ls', '命令', 10), 'ls');
  bad(() => optText('x'.repeat(11), '命令', 10));
  bad(() => optText(123, '命令', 10));
});

test('POWER_ACTIONS', () => {
  assert.deepEqual(POWER_ACTIONS, ['boot', 'shutdown', 'restart', 'poweroff']);
});
