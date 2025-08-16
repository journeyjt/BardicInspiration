import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath, URL } from 'node:url';
import fs from 'fs';

export default defineConfig({
  root: './',
  base: '/modules/bardic-inspiration/',
  publicDir: false, // Disable default public dir to avoid conflicts
  
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
    // Custom middleware to serve module files
    middlewares: [
      {
        name: 'serve-module-files',
        configureServer(server) {
          const projectRoot = fileURLToPath(new URL('.', import.meta.url));
          
          server.middlewares.use('/modules/bardic-inspiration/module.json', (req, res, next) => {
            const filePath = resolve(projectRoot, 'module.json');
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/json');
              res.end(fs.readFileSync(filePath));
            } else {
              next();
            }
          });
          
          server.middlewares.use('/modules/bardic-inspiration/module.zip', (req, res, next) => {
            const filePath = resolve(projectRoot, 'module.zip');
            if (fs.existsSync(filePath)) {
              res.setHeader('Content-Type', 'application/zip');
              res.setHeader('Content-Disposition', 'attachment; filename="module.zip"');
              res.end(fs.readFileSync(filePath));
            } else {
              next();
            }
          });
          
          // Serve dist files
          server.middlewares.use('/modules/bardic-inspiration/dist', (req, res, next) => {
            const fileName = req.url.split('/').pop();
            const filePath = resolve(projectRoot, 'dist', fileName);
            if (fs.existsSync(filePath)) {
              if (fileName.endsWith('.css')) {
                res.setHeader('Content-Type', 'text/css');
              } else if (fileName.endsWith('.js')) {
                res.setHeader('Content-Type', 'application/javascript');
              }
              res.end(fs.readFileSync(filePath));
            } else {
              next();
            }
          });
        }
      }
    ],
  },

  build: {
    outDir: resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist'),
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/main.ts'),
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
    noDiscovery: true, // Disable dependency discovery in dev mode
    include: [], // Empty array to disable pre-bundling
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