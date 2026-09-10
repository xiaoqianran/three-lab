import { defineConfig } from 'vite'

// HMR 走反向代理 / 隧道时，浏览器看到的端口和协议往往跟 dev server 本地监听的
// 不一致（例如 HTTPS 隧道只暴露 443）。这种情况显式指定：
//   VITE_HMR_CLIENT_PORT=443 pnpm dev
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT

export default defineConfig({
  // 产物用相对路径，dist 丢到任意子目录 / 反代前缀下都能直接打开
  base: './',

  server: {
    // 监听 0.0.0.0：局域网、容器外、公网都能连
    host: true,
    port: 5173,
    strictPort: false,
    // 关键项：允许任意 Host 头，否则域名/隧道访问会被 "Blocked request" 拦截
    allowedHosts: true,
    cors: true,
    hmr: hmrClientPort ? { clientPort: Number(hmrClientPort) } : undefined,
  },

  preview: {
    host: true,
    port: 4173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },

  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
