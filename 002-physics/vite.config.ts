import { defineConfig } from 'vite'

const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT

export default defineConfig({
  base: './',

  server: {
    host: true,
    port: 5273,
    strictPort: false,
    // 允许任意 Host 头，否则域名 / 隧道访问会被 "Blocked request" 拦截
    allowedHosts: true,
    cors: true,
    hmr: hmrClientPort ? { clientPort: Number(hmrClientPort) } : undefined,
  },

  preview: {
    host: true,
    port: 4273,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },

  build: {
    target: 'es2022',
    sourcemap: false,
  },
})
