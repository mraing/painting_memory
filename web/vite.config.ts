import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        id: 'huiyi',
        name: '绘忆 · 时光绘本',
        short_name: '绘忆',
        description: '把照片收进一本会说话的立体绘本',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4efe6',
        theme_color: '#f4efe6',
        categories: ['lifestyle', 'books'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 字体子集不进 precache（安装负担），走下方 runtimeCaching CacheFirst：首次用到才拉取并缓存
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        globIgnores: ['**/*.woff', '**/*.woff2'],
        runtimeCaching: [
          // 字体：CacheFirst 懒缓存（unicode-range 分包，命中哪个缓存哪个）
          {
            urlPattern: /\.(woff2?)(\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'huiyi-fonts',
              expiration: { maxEntries: 140, maxAgeSeconds: 365 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // 局域网访问：监听 0.0.0.0，手机/平板经「电脑局域网 IP:4177」访问
  server: {
    host: '0.0.0.0',
    port: 4177,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  // ⚠ 立绘管线已移至 Python 后端（server/，2026-08 技术路线调整）：
  // 前端不再打包 opencv.js / 不再创建转换 Worker，此处相关配置（optimizeDeps.exclude、
  // worker.format）已移除；10MB+ 的 opencv chunk 与 WASM 内存负担全部下线。
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
