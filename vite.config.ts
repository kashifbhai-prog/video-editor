import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { htmlEntries, cutisticSite } from './site/plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Website pages (landing, help center, legal) around the editor.
      cutisticSite({
        siteUrl: env.VITE_SITE_URL || 'https://www.example.com',
        contactEmail: env.VITE_CONTACT_EMAIL || 'support@example.com',
        gaId: env.VITE_GA_ID || '',
        adsenseClient: env.VITE_ADSENSE_CLIENT || '',
        adsenseSlot: env.VITE_ADSENSE_SLOT || '',
      }),
    ],
    server: { port: 5173 },
    // Multi-page build: the website pages + the editor (/editor/).
    build: { rollupOptions: { input: htmlEntries(process.cwd()) } },
    // Workers are ES modules: the AI worker loads its models' runtimes with dynamic import().
    worker: { format: 'es' },
    // Pre-bundle the AI libraries at dev-server start. They are only imported from
    // the AI worker / on demand, so Vite would otherwise discover them mid-session
    // and reload the page (interrupting e.g. a running transcription).
    optimizeDeps: { include: ['@huggingface/transformers', '@shiguredo/rnnoise-wasm', '@mediapipe/tasks-vision', 'mediabunny'] },
  };
});
