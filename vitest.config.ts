import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    exclude: ['tests/ui/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@server': path.resolve(__dirname, 'server'),
    },
  },
})