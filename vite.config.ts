import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Served from the site root (Cloudflare Pages). Use BASE=/sub/path/ for a sub-folder host.
  base: process.env.BASE ?? '/',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'In-hand Salary Calculator',
        short_name: 'In-hand',
        description: 'See what your offer letter really pays each month, after tax. Works offline.',
        theme_color: '#1f5fae',
        background_color: '#fcfcfb',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // App shell + PDF/DOCX readers are precached; the OCR engine (~10 MB) is cached on first use.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest}'],
        globIgnores: ['ocr/**', 'rules.json'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Tax rules: always try the network, fall back to the last copy offline.
            urlPattern: ({ url }) => url.pathname.endsWith('/rules.json'),
            handler: 'NetworkFirst',
            options: { cacheName: 'rules', networkTimeoutSeconds: 5 },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ocr', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
