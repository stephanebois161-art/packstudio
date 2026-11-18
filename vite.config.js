import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Chemins relatifs : le site fonctionne aussi dans un sous-dossier (GitHub Pages).
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
      },
    },
  },
});
