'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishWeb } = require('../scripts/publish-web');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'alice-publish-'));
const write = (dir, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
};

test('把构建产物整个复制成发布目录（含子目录），并清掉发布目录里的旧文件', () => {
  const root = tmp();
  const src = path.join(root, 'out');
  const dest = path.join(root, 'public');
  write(src, 'index.html', '<p>new</p>');
  write(src, '_next/static/app.js', 'a()');
  write(dest, 'assets/old-hash.js', 'old()'); // 上一版 Vite 构建留下的文件
  publishWeb(src, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), '<p>new</p>');
  assert.equal(fs.readFileSync(path.join(dest, '_next/static/app.js'), 'utf8'), 'a()');
  assert.equal(fs.existsSync(path.join(dest, 'assets')), false);
});

test('构建产物不存在时报错，并且不动现有的发布目录', () => {
  const root = tmp();
  const dest = path.join(root, 'public');
  write(dest, 'index.html', 'keep me');
  assert.throws(() => publishWeb(path.join(root, 'out'), dest), /没有找到前端构建产物/);
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), 'keep me');
});

test('构建产物里没有 index.html 时同样报错（不会把空目录发布出去）', () => {
  const root = tmp();
  const src = path.join(root, 'out');
  const dest = path.join(root, 'public');
  write(src, 'other.txt', 'x');
  write(dest, 'index.html', 'keep me');
  assert.throws(() => publishWeb(src, dest), /index\.html/);
  assert.equal(fs.readFileSync(path.join(dest, 'index.html'), 'utf8'), 'keep me');
});
