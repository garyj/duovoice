import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// Dev mode: Vite serves the page on :5173 and proxies API + WebSocket routes
// to uvicorn on :8000. In production FastAPI serves the built dist/ itself on
// one port, so app code only ever uses relative URLs.
export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
