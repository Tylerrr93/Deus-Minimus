import { defineConfig } from 'vite';

export default defineConfig({
  // Set base to your repo name for GitHub Pages
  // Change 'deus-minimus' to your actual GitHub repo name
  base: '/Deus-Minimus/',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
