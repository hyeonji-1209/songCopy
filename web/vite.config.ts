import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { alphaTab } from '@coderline/alphatab-vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), alphaTab()],
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
