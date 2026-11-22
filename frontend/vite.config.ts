import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dayweaveMessages from './i18n-plugin.mjs'

export default defineConfig({
  plugins: [react({ babel: { plugins: [dayweaveMessages] } })],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
})
