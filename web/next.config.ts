import type { NextConfig } from "next"

// 生产构建：静态导出到 out/，由上一级的 server.js 直接提供，运行时不需要 Next 服务。
// 开发（next dev）：静态导出不支持 rewrites，所以只在开发时不开 output，
// 把 /api 转发给本地的面板后端（默认 8080 端口，可用 PANEL_URL 指定其他地址）。
const isDev = process.env.NODE_ENV === "development"

const nextConfig: NextConfig = isDev
  ? {
      async rewrites() {
        const target = process.env.PANEL_URL || "http://127.0.0.1:8080"
        return [{ source: "/api/:path*", destination: `${target}/api/:path*` }]
      },
    }
  : { output: "export" }

export default nextConfig
