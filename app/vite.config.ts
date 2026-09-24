import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives in app/ but its content is generated into app/public/ by
// scripts/build-content.mjs (see the pre-dev / pre-build hooks in package.json).
// base is relative so `npm run build` produces a dist/ you can open from a file
// server, a subpath, or GitHub Pages without reconfiguring anything.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, open: true },
  build: { outDir: 'dist' },
});
