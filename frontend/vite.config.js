import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  server: {
    port: 31201,
    strictPort: true,
  },
  // en el build de producción se eliminan console.* y debugger (en dev se mantienen)
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
}))
