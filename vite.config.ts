import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true,
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(isDev ? env.GEMINI_API_KEY : ''),
      'process.env.GEMINI_API_KEY': JSON.stringify(isDev ? env.GEMINI_API_KEY : ''),
      'process.env.OPENAI_API_KEY': JSON.stringify(isDev ? env.OPENAI_API_KEY : ''),
      'process.env.OPENAI_REALTIME_MODEL': JSON.stringify(
        env.OPENAI_REALTIME_MODEL,
      ),
      'process.env.SILENCE_DURATION_MS': JSON.stringify(
        env.SILENCE_DURATION_MS,
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
