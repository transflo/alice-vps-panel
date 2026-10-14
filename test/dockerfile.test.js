'use strict';

// 回归测试：server.js require 的本地模块必须都在 Dockerfile 的 COPY 清单里，
// 否则镜像里缺文件，容器启动即崩溃（无限重启）。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Dockerfile 复制了 server.js 需要的全部本地模块', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const copyLine = dockerfile.split('\n').find((l) => l.startsWith('COPY package.json'));
  assert.ok(copyLine, 'Dockerfile 里没有找到 COPY package.json 行');
  const copied = copyLine.split(/\s+/).slice(1, -1);

  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const required = [...new Set([...server.matchAll(/require\('\.\/([a-z-]+)'\)/g)].map((m) => `${m[1]}.js`))];
  assert.ok(required.length > 0);
  for (const mod of required) {
    assert.ok(copied.includes(mod), `server.js 需要 ./${mod}，但 Dockerfile 没有 COPY 它`);
    assert.ok(fs.existsSync(path.join(root, mod)), `./${mod} 文件不存在`);
  }
});
