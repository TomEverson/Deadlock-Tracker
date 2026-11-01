import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    // Workspace TS source must be bundled; real npm deps stay external.
    build: { externalizeDeps: { exclude: ['@deadlock/core'] } },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias: { '~': resolve(import.meta.dirname, 'src/renderer/src') } },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve(import.meta.dirname, 'src/renderer/src/routes'),
        generatedRouteTree: resolve(import.meta.dirname, 'src/renderer/src/routeTree.gen.ts'),
      }),
      react(),
      tailwindcss(),
    ],
  },
})
