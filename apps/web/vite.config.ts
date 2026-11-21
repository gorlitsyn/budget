import fs from 'node:fs';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Ревизия: deploy.sh кладёт файл REVISION в корень копии репо на сервере, локально — 'dev'.
const revision = (() => {
  try {
    return fs.readFileSync(new URL('../../REVISION', import.meta.url), 'utf8').trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  define: { __APP_REVISION__: JSON.stringify(revision) },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // Регистрирует src/pwa.ts: нужны проверки обновления и перезагрузка, см. там.
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Бюджет',
        short_name: 'Бюджет',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Плагин включает их сам только при injectRegister: 'auto'; без них новая версия ждёт,
        // пока закроют все вкладки, — у PWA на iPhone это «никогда».
        skipWaiting: true,
        clientsClaim: true,
        // API всегда из сети: в кэше SW не должно оказаться чужих данных после смены аккаунта.
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
    // Тот же origin для фронта и API — как в проде за nginx; passkeys и cookie без CORS.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
