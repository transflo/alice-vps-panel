'use strict';

// 把前端构建产物（web/out，Next.js 静态导出）复制成 server.js 提供的 public/。
// 先检查构建产物，确认没问题再清掉旧的 public/，避免构建失败时把现有页面也删了。

const fs = require('node:fs');
const path = require('node:path');

function publishWeb(src, dest) {
  if (!fs.existsSync(src)) throw new Error(`没有找到前端构建产物 ${src}，请先在 web/ 里运行 pnpm build`);
  if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error(`${src} 里没有 index.html，前端构建可能没有成功`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  try {
    publishWeb(path.join(root, 'web', 'out'), path.join(root, 'public'));
    console.log('前端已发布到 public/');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { publishWeb };
