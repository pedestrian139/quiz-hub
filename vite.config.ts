import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.endsWith('/src/data/bank.json') || id.endsWith('\\src\\data\\bank.json')) {
            return 'bank-data';
          }
          if (id.endsWith('/src/data/notes.json') || id.endsWith('\\src\\data\\notes.json')) {
            return 'notes-data';
          }
          return undefined;
        },
      },
    },
  },
});
