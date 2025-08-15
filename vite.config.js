import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: './',
  base: '/modules/bardic-inspiration/',
  publicDir: resolve(__dirname, 'public'),
  
  server: {
    port: 5000, // Fixed development port
    host: '0.0.0.0', // Allow external connections
    allowedHosts: ['host.docker.internal'], // Allow Docker host access
    open: false,
    strictPort: true, // Fail if port is in use instead of auto-incrementing
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    },
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