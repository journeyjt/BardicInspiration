import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src/',
  base: '/modules/bardic-inspiration/',
  publicDir: resolve(__dirname, 'public'),
  
  server: {
    port: 30001,
    open: false,
    proxy: {
      '^(?!/modules/bardic-inspiration/).*': 'http://localhost:30000',
      '/socket.io': {
        target: 'http://localhost:30000',
        ws: true,
      },
    },
  },

  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      formats: ['es'],
      fileName: 'main',
    },
    rollupOptions: {
      external: [
        // FoundryVTT globals - don't bundle these
        /^\/scripts\//,
        /^\/systems\//,
        /^\/modules\//
      ],
      output: {
        // Ensure external modules are not bundled
        globals: {
          // Define globals if needed
        },
      },
    },
  },

  // Define global constants for FoundryVTT
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },

  // Optimize dependencies
  optimizeDeps: {
    exclude: [
      // Exclude FoundryVTT-specific modules from pre-bundling
    ],
  },

  // CSS handling
  css: {
    devSourcemap: true,
  },

  // Development-specific settings
  esbuild: {
    target: 'esnext',
    keepNames: true,
  },
});