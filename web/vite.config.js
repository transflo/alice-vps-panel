import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 构建产物输出到上一级的 public/，由 server.js 直接提供。
// 开发时运行 `npm run dev`，接口请求转发给本地 8080 端口的面板后端（可用 PANEL_URL 指定其他地址）。
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      '/api': process.env.PANEL_URL || 'http://127.0.0.1:8080',
    },
  },
});
