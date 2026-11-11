import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // Workers are ES modules: the AI worker loads its models' runtimes with dynamic import().
  worker: { format: 'es' },
  // Pre-bundle the AI libraries at dev-server start. They are only imported from
  // the AI worker / on demand, so Vite would otherwise discover them mid-session
  // and reload the page (interrupting e.g. a running transcription).
  optimizeDeps: { include: ['@huggingface/transformers', '@shiguredo/rnnoise-wasm', '@mediapipe/tasks-vision', 'mediabunny'] },
});
