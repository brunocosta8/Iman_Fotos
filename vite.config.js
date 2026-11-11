import { defineConfig } from 'vite';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

// BASE_PATH = '/<nome-do-repositório>/' no GitHub Pages (definido no workflow de deploy).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: { chunkSizeWarningLimit: 700 }, // o conversor de vídeo (~150 KB gzip) só carrega ao enviar vídeos
  plugins: [
    {
      // O GitHub Pages não tem rewrites: qualquer caminho desconhecido (ex.: /a/<slug>)
      // serve o 404.html. Sendo uma cópia do index.html, a app abre e lê o caminho.
      name: 'spa-fallback-404',
      apply: 'build',
      writeBundle(options) {
        const dir = options.dir || 'dist';
        copyFileSync(resolve(dir, 'index.html'), resolve(dir, '404.html'));
      },
    },
  ],
});
