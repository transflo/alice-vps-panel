# Alice 面板前端

Next.js（App Router）+ shadcn/ui（`base-maia` 风格）+ Tailwind CSS，TypeScript。生产构建是静态导出（`output: "export"`），由上一级的 `server.js` 提供。

常用命令（在 `web/` 里运行，需要 pnpm）：

```bash
pnpm install
pnpm dev      # http://localhost:3000，/api 转发给本地 8080 端口的面板后端（PANEL_URL 可改）
pnpm check    # 类型检查 + lint
pnpm build    # 静态导出到 out/
```

完整说明（构建、Docker、CSP、加组件的方法）见仓库根目录的 [README](../README.md)。
