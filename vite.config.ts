import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // Workers are ES modules: the AI worker loads its models' runtimes with dynamic import().
  worker: { format: 'es' },
});
