# Alice 面板前端

Next.js（App Router）+ shadcn/ui（`base-mira` 风格，底层 Base UI，图标用 lucide）+ Tailwind CSS v4，TypeScript 编写。
生产构建是**静态导出**：`pnpm build` 产出 `web/out/`，再由根目录的 `scripts/publish-web.js` 复制到 `public/` 交给 `server.js` 托管，运行时不需要 Next 服务。

## 开发

先在仓库根目录把后端跑起来（默认 8080），然后：

```bash
pnpm install
pnpm dev      # http://localhost:3000，/api 请求由 rewrites 转发给后端（PANEL_URL 可改地址）
pnpm check    # 类型检查 + lint
pnpm build    # 静态导出到 out/
```

`next.config.ts` 在开发时配置 `rewrites` 代理、构建时配置 `output: "export"`——静态导出不支持 `rewrites` / `headers`，所以响应头（CSP 等）统一由 `server.js` 负责。

## 目录

- `app/` — 页面入口、全局样式（Tailwind 主题变量）、布局
- `components/` — 面板自己的组件：仪表盘、实例卡片、登录页、语言与主题 provider 等
- `components/dialogs/` — 新建、重装、自动续期、详情、删除、执行命令、设置等弹窗
- `components/ui/` — shadcn CLI 生成的组件，尽量不手改
- `hooks/` — 列表与弹窗的数据加载、命令结果轮询
- `lib/` — 接口封装、缓存、i18n 字典、Alice 数据整理

## 加组件

```bash
pnpm dlx shadcn@latest add tabs
```

生成的组件落在 `components/ui/`，用法以 <https://ui.shadcn.com/docs> 为准。本项目是 Base UI 底座（不是 Radix）：自定义触发器用 `render` 而不是 `asChild`，`Select` 需要 `items`，提示用 `@/components/ui/toast` 的 `toast.add()`（不是 sonner）。

## 文案

界面文案都在 `lib/i18n/` 下的 9 份字典里，简体中文是基准，键由 `Dict = typeof zhCN` 约束——**加键必须同时补齐另外 8 份**，否则类型检查不过。
