import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages 项目页部署：仓库名为 pic-toolkit
  base: '/pic-toolkit/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: '图片工具箱',
        short_name: '图片工具箱',
        description: '12 个纯前端本地图片工具：AI 抠图与证件照换底色、九宫格切图、批量水印、压缩、格式转换、长图与网格拼图、超分放大、美颜、局部改色。支持 HEIC 导入与 ZIP 批量导出，图片全程在本机处理、绝不上传，可离线使用',
        lang: 'zh-CN',
        theme_color: '#4f6ef7',
        background_color: '#f5f6fa',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 推理资源体积大（抠图模型 42MB、onnxruntime wasm 25MB），不进 precache，
        // 改为首次用到时缓存、此后长期复用；否则每次回访都要重新下载几十 MB，
        // "可离线使用"也不成立。
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) =>
              sameOrigin && /\/(models|assets)\/[^?]*\.(onnx|task|wasm)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'inference-assets',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // @imgly 抠图模型分片托管在境外 CDN，重下成本最高，优先长期缓存
            urlPattern: ({ url }) => url.hostname === 'staticimgly.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'imgly-model-chunks',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'vendor-wasm',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
})
